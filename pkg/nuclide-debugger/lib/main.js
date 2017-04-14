/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import type {
   NuclideDebuggerProvider,
   NuclideEvaluationExpressionProvider,
} from '../../nuclide-debugger-interfaces/service';
import type {
  DatatipProvider,
  DatatipService,
} from '../../nuclide-datatip/lib/types';
import type {GetToolBar} from '../../commons-atom/suda-tool-bar';
import type {RegisterExecutorFunction} from '../../nuclide-console/lib/types';
import type {WorkspaceViewsService} from '../../nuclide-workspace-views/lib/types';
import type {
  EvaluationResult,
  SerializedBreakpoint,
} from './types';
import type {Observable} from 'rxjs';
import type {WatchExpressionStore} from './WatchExpressionStore';
import type {NuxTourModel} from '../../nuclide-nux/lib/NuxModel';
import type {
  RegisterNux,
  TriggerNux,
} from '../../nuclide-nux/lib/main';

import UniversalDisposable from '../../commons-node/UniversalDisposable';
import {Subject} from 'rxjs';
import invariant from 'assert';
import classnames from 'classnames';
import {Disposable} from 'atom';
import {
  track,
  trackTiming,
} from '../../nuclide-analytics';
import RemoteControlService from './RemoteControlService';
import DebuggerModel, {WORKSPACE_VIEW_URI} from './DebuggerModel';
import {debuggerDatatip} from './DebuggerDatatip';
import React from 'react';
import {DebuggerLaunchAttachUI} from './DebuggerLaunchAttachUI';
import {renderReactRoot} from '../../commons-atom/renderReactRoot';
import nuclideUri from '../../commons-node/nuclideUri';
import {ServerConnection} from '../../nuclide-remote-connection';
import {setNotificationService} from '../../nuclide-debugger-base';
import {NewDebuggerView} from './NewDebuggerView';
import DebuggerControllerView from './DebuggerControllerView';
import {wordAtPosition, trimRange} from '../../commons-atom/range';
import {DebuggerLaunchAttachEventTypes} from '../../nuclide-debugger-base';
import os from 'os';

export type SerializedState = {
  breakpoints: ?Array<SerializedBreakpoint>,
};

const DATATIP_PACKAGE_NAME = 'nuclide-debugger-datatip';
const NUX_NEW_DEBUGGER_UI_ID = 4377;
const GK_NEW_DEBUGGER_UI_NUX = 'mp_nuclide_new_debugger_ui';
const NUX_NEW_DEBUGGER_UI_NAME = 'nuclide_new_debugger_ui';

type Props = {
  model: DebuggerModel,
};
type State = {
  showOldView: boolean,
};
class DebuggerView extends React.Component {
  props: Props;
  state: State;
  _nuxTimeout: ?number;

  constructor(props: Props) {
    super(props);
    this.state = {
      showOldView: false,
    };
    (this: any)._openDevTools = this._openDevTools.bind(this);
    (this: any)._stopDebugging = this._stopDebugging.bind(this);
  }

  _getUiTypeForAnalytics(): string {
    return this.state.showOldView ? 'chrome-devtools' : 'nuclide';
  }

  componentDidMount(): void {
    track('debugger-ui-mounted', {
      frontend: this._getUiTypeForAnalytics(),
    });
    // Wait for UI to initialize and "calm down"
    this._nuxTimeout = setTimeout(() => {
      if (activation != null && !this.state.showOldView) {
        activation.tryTriggerNux(NUX_NEW_DEBUGGER_UI_ID);
      }
    }, 2000);
  }

  componentDidUpdate(prevProps: Props, prevState: State): void {
    if (prevState.showOldView !== this.state.showOldView) {
      track('debugger-ui-toggled', {
        frontend: this._getUiTypeForAnalytics(),
      });
    }
  }

  componentWillUnmount(): void {
    if (this._nuxTimeout) {
      clearTimeout(this._nuxTimeout);
    }
  }

  _openDevTools(): void {
    this.props.model.getActions().openDevTools();
  }

  _stopDebugging(): void {
    this.props.model.getActions().stopDebugging();
  }

  render(): React.Element<any> {
    const {
      model,
    } = this.props;
    const {showOldView} = this.state;
    return (
      <div className="nuclide-debugger-root">
        <div className={classnames({'nuclide-debugger-container-old-enabled': showOldView})}>
          <DebuggerControllerView
            store={model.getStore()}
            bridge = {model.getBridge()}
            breakpointStore={model.getBreakpointStore()}
            openDevTools={this._openDevTools}
            stopDebugging={this._stopDebugging}
          />
        </div>
        {!showOldView
          ? <NewDebuggerView
              model={model}
              watchExpressionListStore={model.getWatchExpressionListStore()}
            />
          : null
        }
        </div>
    );
  }
}

export function createDebuggerView(model: mixed): ?HTMLElement {
  if (!(model instanceof DebuggerModel)) {
    return;
  }
  const elem = renderReactRoot(<DebuggerView model={model} />);
  elem.className = 'nuclide-debugger-container';
  return elem;
}

class Activation {
  _disposables: UniversalDisposable;
  _model: DebuggerModel;
  _launchAttachDialog: ?atom$Panel;
  _tryTriggerNux: ?TriggerNux;

  constructor(state: ?SerializedState) {
    this._model = new DebuggerModel(state);
    this._launchAttachDialog = null;
    this._disposables = new UniversalDisposable(
      this._model,
      // Listen for removed connections and kill the debugger if it is using that connection.
      ServerConnection.onDidCloseServerConnection(connection => {
        const debuggerProcess = this._model.getStore().getDebuggerInstance();
        if (debuggerProcess == null) {
          return; // Nothing to do if we're not debugging.
        }
        const debuggeeTargetUri = debuggerProcess.getTargetUri();
        if (nuclideUri.isLocal(debuggeeTargetUri)) {
          return; // Nothing to do if our debug session is local.
        }
        if (nuclideUri.getHostname(debuggeeTargetUri) === connection.getRemoteHostname()) {
          this._model.getActions().stopDebugging();
        }
      }),

      // Commands.
      atom.commands.add('atom-workspace', {
        'nuclide-debugger:toggle': this._toggleLaunchAttachDialog.bind(this),
      }),
      atom.commands.add('atom-workspace', {
        'nuclide-debugger:continue-debugging': this._continue.bind(this),
      }),
      atom.commands.add('atom-workspace', {
        'nuclide-debugger:stop-debugging': this._stop.bind(this),
      }),
      atom.commands.add('atom-workspace', {
        'nuclide-debugger:step-over': this._stepOver.bind(this),
      }),
      atom.commands.add('atom-workspace', {
        'nuclide-debugger:step-into': this._stepInto.bind(this),
      }),
      atom.commands.add('atom-workspace', {
        'nuclide-debugger:step-out': this._stepOut.bind(this),
      }),
      atom.commands.add('atom-workspace', {
        'nuclide-debugger:toggle-breakpoint': this._toggleBreakpoint.bind(this),
      }),
      atom.commands.add('atom-workspace', {
        'nuclide-debugger:toggle-launch-attach': this._toggleLaunchAttachDialog.bind(this),
      }),
      atom.commands.add('atom-workspace', {
        'nuclide-debugger:remove-all-breakpoints': this._deleteAllBreakpoints.bind(this),
      }),
      atom.commands.add('atom-workspace', {
        'nuclide-debugger:remove-breakpoint': this._deleteBreakpoint.bind(this),
      }),
      atom.commands.add('atom-workspace', {
        'nuclide-debugger:add-to-watch': this._addToWatch.bind(this),
      }),
      atom.commands.add('atom-workspace', {
        'nuclide-debugger:run-to-location': this._runToLocation.bind(this),
      }),
      atom.commands.add('.nuclide-debugger-root', {
        'nuclide-debugger:copy-debugger-expression-value':
            this._copyDebuggerExpressionValue.bind(this),
      }),
      atom.commands.add('.nuclide-debugger-root', {
        'nuclide-debugger:copy-debugger-callstack':
            this._copyDebuggerCallstack.bind(this),
      }),

      // Context Menu Items.
      atom.contextMenu.add({
        '.nuclide-debugger-breakpoint': [
          {
            label: 'Remove Breakpoint',
            command: 'nuclide-debugger:remove-breakpoint',
          },
          {
            label: 'Remove All Breakpoints',
            command: 'nuclide-debugger:remove-all-breakpoints',
          },
        ],
        '.nuclide-debugger-callstack-table': [
          {
            label: 'Copy Callstack',
            command: 'nuclide-debugger:copy-debugger-callstack',
          },
        ],
        '.nuclide-debugger-expression-value-list .list-item': [
          {
            label: 'Copy',
            command: 'nuclide-debugger:copy-debugger-expression-value',
          },
        ],
        'atom-text-editor': [
          {type: 'separator'},
          {
            label: 'Debugger',
            submenu: [
              {
                label: 'Toggle Breakpoint',
                command: 'nuclide-debugger:toggle-breakpoint',
              },
              {
                label: 'Add to Watch',
                command: 'nuclide-debugger:add-to-watch',
              },
              {
                label: 'Run to Location',
                command: 'nuclide-debugger:run-to-location',
              },
            ],
          },
          {type: 'separator'},
        ],
      }),
    );
    (this: any)._hideLaunchAttachDialog = this._hideLaunchAttachDialog.bind(this);
    (this: any)._handleDefaultAction = this._handleDefaultAction.bind(this);
  }

  serialize(): SerializedState {
    const state = {
      breakpoints: this.getModel().getBreakpointStore().getSerializedBreakpoints(),
    };
    return state;
  }

  dispose() {
    this._disposables.dispose();
  }

  getModel(): DebuggerModel {
    return this._model;
  }

  consumeRegisterNuxService(addNewNux: RegisterNux): Disposable {
    const disposable = addNewNux(createDebuggerNuxTourModel());
    this._disposables.add(disposable);
    return disposable;
  }

  consumeWorkspaceViewsService(api: WorkspaceViewsService): void {
    this._disposables.add(
      api.addOpener(uri => {
        if (uri === WORKSPACE_VIEW_URI) {
          return this._model;
        }
      }),
      () => { api.destroyWhere(item => item instanceof DebuggerModel); },
      atom.commands.add('atom-workspace', {
        'nuclide-debugger:show': () => { api.open(WORKSPACE_VIEW_URI, {searchAllPanes: true}); },
      }),
      atom.commands.add('atom-workspace', {
        'nuclide-debugger:hide': () => { api.destroyWhere(item => item instanceof DebuggerModel); },
      }),
    );
  }

  setTriggerNux(triggerNux: TriggerNux): void {
    this._tryTriggerNux = triggerNux;
  }

  tryTriggerNux(id: number): void {
    if (this._tryTriggerNux != null) {
      this._tryTriggerNux(id);
    }
  }

  _continue() {
    // TODO(jeffreytan): when we figured out the launch lifecycle story
    // we may bind this to start-debugging too.
    this._model.getBridge().continue();
  }

  _stop() {
    this._model.getActions().stopDebugging();
  }

  _stepOver() {
    this._model.getBridge().stepOver();
  }

  _stepInto() {
    this._model.getBridge().stepInto();
  }

  _stepOut() {
    this._model.getBridge().stepOut();
  }

  _toggleBreakpoint() {
    return trackTiming('nuclide-debugger-atom:toggleBreakpoint', () => {
      this._executeWithEditorPath((filePath, line) => {
        this._model.getActions().toggleBreakpoint(filePath, line);
      });
    });
  }

  _runToLocation() {
    this._executeWithEditorPath((path, line) => {
      this._model.getBridge().runToLocation(path, line);
    });
  }

  _executeWithEditorPath(fn) {
    const editor = atom.workspace.getActiveTextEditor();
    if (editor && editor.getPath()) {
      const filePath = editor.getPath();
      if (filePath) {
        const line = editor.getLastCursor().getBufferRow();
        fn(filePath, line);
      }
    }
  }

  _deleteBreakpoint(event: any): void {
    const actions = this._model.getActions();
    const target = (event.target: HTMLElement);
    const path = target.dataset.path;
    const line = parseInt(target.dataset.line, 10);
    if (path == null) {
      return;
    }
    actions.deleteBreakpoint(path, line);
  }

  _deleteAllBreakpoints(): void {
    const actions = this._model.getActions();
    actions.deleteAllBreakpoints();
  }

  _toggleLaunchAttachDialog(): void {
    const dialog = this._getLaunchAttachDialog();
    if (dialog.isVisible()) {
      dialog.hide();
    } else {
      dialog.show();
    }
    this._emitLaunchAttachVisibilityChangedEvent();
  }

  _hideLaunchAttachDialog(): void {
    const dialog = this._getLaunchAttachDialog();
    if (dialog.isVisible()) {
      dialog.hide();
    }
    this._emitLaunchAttachVisibilityChangedEvent();
  }

  _emitLaunchAttachVisibilityChangedEvent() {
    const dialog = this._getLaunchAttachDialog();
    this._model.getLaunchAttachActionEventEmitter().emit(
      DebuggerLaunchAttachEventTypes.VISIBILITY_CHANGED,
      dialog.isVisible(),
    );
  }

  _handleDefaultAction(): void {
    const dialog = this._getLaunchAttachDialog();
    if (dialog.isVisible()) {
      this._model.getLaunchAttachActionEventEmitter().emit(
        DebuggerLaunchAttachEventTypes.ENTER_KEY_PRESSED);
    }
  }

  _getLaunchAttachDialog(): atom$Panel {
    if (!this._launchAttachDialog) {
      const component = (
        <DebuggerLaunchAttachUI
          store={this._model.getDebuggerProviderStore()}
          debuggerActions={this._model.getActions()}
          emitter={this._model.getLaunchAttachActionEventEmitter()}
        />
      );
      const host = renderReactRoot(component);
      this._launchAttachDialog = atom.workspace.addModalPanel({
        item: host,
        visible: false, // Hide first so that caller can toggle it visible.
      });

      this._disposables.add(
        () => {
          if (this._launchAttachDialog != null) {
            this._launchAttachDialog.destroy();
            this._launchAttachDialog = null;
          }
        },
        atom.commands.add(
          'atom-workspace',
          'core:cancel',
          this._hideLaunchAttachDialog,
        ),
        atom.commands.add(
          'atom-workspace',
          'core:confirm',
          this._handleDefaultAction,
        ),
      );
    }
    invariant(this._launchAttachDialog);
    return this._launchAttachDialog;
  }

  _addToWatch() {
    const editor = atom.workspace.getActiveTextEditor();
    if (!editor) {
      return;
    }
    const selectedText = editor.getTextInBufferRange(
      trimRange(editor, editor.getSelectedBufferRange()),
    );
    const expr = wordAtPosition(editor, editor.getCursorBufferPosition());

    const watchExpression = selectedText || (expr && expr.wordMatch[0]);
    if (watchExpression) {
      this._model.getActions().addWatchExpression(watchExpression);
    }
  }

  _copyDebuggerExpressionValue(event: Event) {
    const clickedElement: HTMLElement = (event.target: any);
    atom.clipboard.write(clickedElement.textContent);
  }

  _copyDebuggerCallstack(event: Event) {
    const callstackStore = this._model.getCallstackStore();
    const callstack = callstackStore.getCallstack();
    if (callstack) {
      let callstackText = '';
      callstack.forEach((item, i) => {
        const path = nuclideUri.basename(item.location.path.replace(/^[a-zA-Z]+:\/\//, ''));
        callstackText += `${i}\t${item.name}\t${path}:${item.location.line}${os.EOL}`;
      });

      atom.clipboard.write(callstackText.trim());
    }
  }
}

function createDatatipProvider(): DatatipProvider {
  if (datatipProvider == null) {
    datatipProvider = {
      // Eligibility is determined online, based on registered EvaluationExpression providers.
      validForScope: (scope: string) => true,
      providerName: DATATIP_PACKAGE_NAME,
      inclusionPriority: 1,
      datatip: (editor: TextEditor, position: atom$Point) => {
        if (activation == null) {
          return Promise.resolve(null);
        }
        const model = activation.getModel();
        return debuggerDatatip(model, editor, position);
      },
    };
  }
  return datatipProvider;
}

let activation = null;
let datatipProvider: ?DatatipProvider;

export function activate(state: ?SerializedState): void {
  if (!activation) {
    activation = new Activation(state);
  }
}

export function serialize(): SerializedState {
  if (activation) {
    return activation.serialize();
  } else {
    return {
      breakpoints: null,
    };
  }
}

export function deactivate() {
  if (activation) {
    activation.dispose();
    activation = null;
  }
}

function registerConsoleExecutor(
  watchExpressionStore: WatchExpressionStore,
  registerExecutor: RegisterExecutorFunction,
): IDisposable {
  const disposables = new UniversalDisposable();
  const rawOutput: Subject<?EvaluationResult> = new Subject();
  const send = expression => {
    disposables.add(
      // We filter here because the first value in the BehaviorSubject is null no matter what, and
      // we want the console to unsubscribe the stream after the first non-null value.
      watchExpressionStore.evaluateConsoleExpression(expression)
        .filter(result => result != null)
        .first()
        .subscribe(result => rawOutput.next(result)),
    );
    watchExpressionStore._triggerReevaluation();
  };
  const output: Observable<{result?: EvaluationResult}> = rawOutput
    .map(result => {
      invariant(result != null);
      return {data: result};
    });
  disposables.add(registerExecutor({
    id: 'debugger',
    name: 'Debugger',
    send,
    output,
    getProperties: watchExpressionStore.getProperties.bind(watchExpressionStore),
  }));
  return disposables;
}

export function consumeRegisterExecutor(registerExecutor: RegisterExecutorFunction): IDisposable {
  if (activation != null) {
    const model = activation.getModel();
    const register = () => registerConsoleExecutor(
      model.getWatchExpressionStore(),
      registerExecutor,
    );
    model.getActions().addConsoleRegisterFunction(register);
    return new Disposable(() => model.getActions().removeConsoleRegisterFunction(register));
  } else {
    return new Disposable();
  }
}

export function consumeDebuggerProvider(provider: NuclideDebuggerProvider): IDisposable {
  if (activation) {
    activation.getModel().getActions().addDebuggerProvider(provider);
  }
  return new Disposable(() => {
    if (activation) {
      activation.getModel().getActions().removeDebuggerProvider(provider);
    }
  });
}

export function consumeEvaluationExpressionProvider(
  provider: NuclideEvaluationExpressionProvider,
): IDisposable {
  if (activation) {
    activation.getModel().getActions().addEvaluationExpressionProvider(provider);
  }
  return new Disposable(() => {
    if (activation) {
      activation.getModel().getActions().removeEvaluationExpressionProvider(provider);
    }
  });
}

export function consumeToolBar(getToolBar: GetToolBar): IDisposable {
  const toolBar = getToolBar('nuclide-debugger');
  toolBar.addButton({
    iconset: 'icon-nuclicon',
    icon: 'debugger',
    callback: 'nuclide-debugger:toggle',
    tooltip: 'Toggle Debugger',
    priority: 500,
  }).element;
  const disposable = new Disposable(() => { toolBar.removeItems(); });
  invariant(activation);
  activation._disposables.add(disposable);
  return disposable;
}

export function consumeNotifications(
  raiseNativeNotification: (title: string, body: string) => void,
): void {
  setNotificationService(raiseNativeNotification);
}

export function provideRemoteControlService(): RemoteControlService {
  return new RemoteControlService(() => (activation ? activation.getModel() : null));
}

export function consumeDatatipService(service: DatatipService): IDisposable {
  const provider = createDatatipProvider();
  service.addProvider(provider);
  const disposable = new Disposable(() => service.removeProvider(provider));
  invariant(activation);
  activation.getModel().getThreadStore().setDatatipService(service);
  activation._disposables.add(disposable);
  return disposable;
}

function createDebuggerNuxTourModel(): NuxTourModel {
  const welcomeToNewUiNux = {
    content: 'Welcome to the new Nuclide debugger UI!</br>' +
      'We are evolving the debugger to integrate more closely with Nuclide.',
    selector: '.nuclide-debugger-container-new',
    position: 'left',
  };

  const newDebuggerUINuxTour = {
    id: NUX_NEW_DEBUGGER_UI_ID,
    name: NUX_NEW_DEBUGGER_UI_NAME,
    nuxList: [welcomeToNewUiNux],
    gatekeeperID: GK_NEW_DEBUGGER_UI_NUX,
  };

  return newDebuggerUINuxTour;
}

export function consumeRegisterNuxService(addNewNux: RegisterNux): Disposable {
  invariant(activation);
  return activation.consumeRegisterNuxService(addNewNux);
}

export function consumeTriggerNuxService(tryTriggerNux: TriggerNux): void {
  if (activation != null) {
    activation.setTriggerNux(tryTriggerNux);
  }
}

export function consumeWorkspaceViewsService(api: WorkspaceViewsService): void {
  invariant(activation);
  activation.consumeWorkspaceViewsService(api);
}
