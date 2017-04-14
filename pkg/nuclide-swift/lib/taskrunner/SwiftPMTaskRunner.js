/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import type {Task} from '../../../commons-node/tasks';
import type {TaskMetadata} from '../../../nuclide-task-runner/lib/types';
import type {Level, Message} from '../../../nuclide-console/lib/types';
import type {Directory} from '../../../nuclide-remote-connection';
import type {SwiftPMTaskRunnerStoreState} from './SwiftPMTaskRunnerStoreState';

import {Observable, Subject} from 'rxjs';
import React from 'react';
import UniversalDisposable from '../../../commons-node/UniversalDisposable';
import fsPromise from '../../../commons-node/fsPromise';
import {observeProcess, exitEventToMessage} from '../../../commons-node/process';
import {observableFromSubscribeFunction} from '../../../commons-node/event';
import {taskFromObservable} from '../../../commons-node/tasks';
import SwiftPMTaskRunnerStore from './SwiftPMTaskRunnerStore';
import SwiftPMTaskRunnerActions from './SwiftPMTaskRunnerActions';
import SwiftPMTaskRunnerDispatcher from './SwiftPMTaskRunnerDispatcher';
import {buildCommand, testCommand} from './SwiftPMTaskRunnerCommands';
import {
  SwiftPMTaskRunnerBuildTaskMetadata,
  SwiftPMTaskRunnerTestTaskMetadata,
  SwiftPMTaskRunnerTaskMetadata,
} from './SwiftPMTaskRunnerTaskMetadata';
import SwiftPMTaskRunnerToolbar from './toolbar/SwiftPMTaskRunnerToolbar';
import SwiftPMAutocompletionProvider from './providers/SwiftPMAutocompletionProvider';
import {Icon} from '../../../nuclide-ui/Icon';
import nullthrows from 'nullthrows';
import nuclideUri from '../../../commons-node/nuclideUri.js';

/**
 * nuclide-swift makes use of the Flux design pattern. The SwiftPMTaskRunner is
 * responsible for kicking off SwiftPM tasks such as building a package. How it
 * builds the package is determined by the state of the
 * SwiftPMTaskRunnerToolbar -- the path to the package, whether a build path is
 * specified, etc. -- and that state is maintained by the
 * SwiftPMTaskRunnerStore. Updates to the toolbar UI options trigger actions,
 * defined in SwiftPMTaskRunnerActions, which update the state of the store.
 * Actions are routed to the store via a Flux.Dispatcher (instantiated by
 * SwiftPMTaskRunner).
 */
type SwiftPMTaskRunnerFlux = {
  store: SwiftPMTaskRunnerStore,
  actions: SwiftPMTaskRunnerActions,
};

/**
 * The primary controller for spawning SwiftPM tasks, such as building a
 * package, or running its tests. This class conforms to Nuclide's TaskRunner
 * interface.
 */
export class SwiftPMTaskRunner {
  id: string;
  name: string;
  _disposables: UniversalDisposable;
  _initialState: ?SwiftPMTaskRunnerStoreState;
  _flux: ?SwiftPMTaskRunnerFlux;
  _autocompletionProvider: ?SwiftPMAutocompletionProvider;
  _outputMessages: Subject<Message>;
  _projectRoot: Subject<?string>;

  constructor(initialState: ?SwiftPMTaskRunnerStoreState) {
    this.id = 'swiftpm';
    this.name = 'Swift';
    this._initialState = initialState;
    this._outputMessages = new Subject();
    this._projectRoot = new Subject();
    this._disposables = new UniversalDisposable(
      this._outputMessages,
      this._projectRoot.subscribe(path => this._getFlux().actions.updateProjectRoot(path)),
    );
  }

  dispose(): void {
    this._disposables.dispose();
  }

  serialize(): SwiftPMTaskRunnerStoreState {
    return this._getFlux().store.serialize();
  }

  getExtraUi(): ReactClass<any> {
    const {store, actions} = this._getFlux();
    return class ExtraUi extends React.Component {
      render(): React.Element<any> {
        return (
          <SwiftPMTaskRunnerToolbar
            store={store}
            actions={actions}
          />
        );
      }
    };
  }

  getIcon(): ReactClass<any> {
    return () => <Icon icon="nuclicon-swift" className="nuclide-swift-task-runner-icon" />;
  }

  runTask(taskName: string): Task {
    const store = this._getFlux().store;
    const chdir = nullthrows(store.getProjectRoot());
    const configuration = store.getConfiguration();
    const buildPath = store.getBuildPath();

    let command;
    switch (taskName) {
      case SwiftPMTaskRunnerBuildTaskMetadata.type:
        command = buildCommand(
          chdir,
          configuration,
          store.getXcc(),
          store.getXlinker(),
          store.getXswiftc(),
          buildPath,
        );
        break;
      case SwiftPMTaskRunnerTestTaskMetadata.type:
        command = testCommand(chdir, buildPath);
        break;
      default:
        throw new Error(`Unknown task name: ${taskName}`);
    }

    atom.commands.dispatch(
      atom.views.getView(atom.workspace),
      'nuclide-console:toggle',
      {visible: true},
    );
    this._logOutput(`${command.command} ${command.args.join(' ')}`, 'log');

    const observable = observeProcess(command.command, command.args)
      .do(message => {
        switch (message.kind) {
          case 'stderr':
          case 'stdout':
            this._logOutput(message.data, 'log');
            break;
          case 'exit':
            if (message.exitCode === 0) {
              this._logOutput(
                `${command.command} exited successfully.`,
                'success',
              );
              this._getFlux().actions.updateCompileCommands(
                chdir,
                configuration,
                buildPath,
              );
            } else {
              this._logOutput(
                `${command.command} failed with ${exitEventToMessage(message)}`,
                'error',
              );
            }
            break;
          default:
            break;
        }
      })
      .ignoreElements();

    const task = taskFromObservable(observable);
    return {
      ...task,
      cancel: () => {
        this._logOutput('Task cancelled.', 'warning');
        task.cancel();
      },
    };
  }

  getAutocompletionProvider(): SwiftPMAutocompletionProvider {
    if (!this._autocompletionProvider) {
      this._autocompletionProvider = new SwiftPMAutocompletionProvider(this._getFlux().store);
    }
    return this._autocompletionProvider;
  }

  getOutputMessages(): Observable<Message> {
    return this._outputMessages;
  }

  setProjectRoot(
    projectRoot: ?Directory,
    callback: (enabled: boolean, taskList: Array<TaskMetadata>) => mixed,
  ): IDisposable {
    const path = projectRoot == null ? null : projectRoot.getPath();

    const storeReady = observableFromSubscribeFunction(
      this._getFlux().store.subscribe.bind(this._getFlux().store))
        .map(() => this._getFlux().store)
        .startWith(this._getFlux().store)
        .filter(store => store.getProjectRoot() === path)
        .share();

    const enabledObservable = storeReady
      .map(store => store.getProjectRoot())
      .distinctUntilChanged()
      .switchMap(root => {
        if (!root || nuclideUri.isRemote(root)) {
          return Observable.of(false);
        }
        return this._packageFileExistsAtPath(root);
      })
      .distinctUntilChanged();

    const tasksObservable = storeReady
      .map(store => SwiftPMTaskRunnerTaskMetadata);

    const subscription = Observable.combineLatest(enabledObservable, tasksObservable)
      .subscribe(([enabled, tasks]) => callback(enabled, tasks));

    this._projectRoot.next(path);

    return new UniversalDisposable(subscription);
  }

  async _packageFileExistsAtPath(path: string): Promise<boolean> {
    return fsPromise.exists(nuclideUri.join(path, 'Package.swift'));
  }

  _logOutput(text: string, level: Level) {
    this._outputMessages.next({text, level});
  }

  _getFlux(): SwiftPMTaskRunnerFlux {
    if (!this._flux) {
      const dispatcher = new SwiftPMTaskRunnerDispatcher();
      const store = new SwiftPMTaskRunnerStore(dispatcher, this._initialState);
      this._disposables.add(store);
      const actions = new SwiftPMTaskRunnerActions(dispatcher);
      this._flux = {store, actions};
    }
    return this._flux;
  }
}
