/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import type {BlameProvider} from './types';
import type FileTreeContextMenu from '../../nuclide-file-tree/lib/FileTreeContextMenu';
import type {FileTreeNode} from '../../nuclide-file-tree/lib/FileTreeNode';

import {CompositeDisposable, Disposable} from 'atom';
import invariant from 'assert';

import BlameGutter from './BlameGutter';
import {getLogger} from '../../nuclide-logging';
import {goToLocation} from '../../commons-atom/go-to-location';
import {repositoryForPath} from '../../nuclide-vcs-base';
import {track, trackTiming} from '../../nuclide-analytics';

const PACKAGES_MISSING_MESSAGE = 'Could not open blame. Missing at least one blame provider.';
const TOGGLE_BLAME_FILE_TREE_CONTEXT_MENU_PRIORITY = 2000;

class Activation {
  _packageDisposables: CompositeDisposable;
  _registeredProviders: Set<BlameProvider>;
  // Map of a TextEditor to its BlameGutter, if it exists.
  _textEditorToBlameGutter: Map<atom$TextEditor, BlameGutter>;
  // Map of a TextEditor to the subscription on its ::onDidDestroy.
  _textEditorToDestroySubscription: Map<atom$TextEditor, IDisposable>;

  constructor() {
    this._registeredProviders = new Set();
    this._textEditorToBlameGutter = new Map();
    this._textEditorToDestroySubscription = new Map();
    this._packageDisposables = new CompositeDisposable();
    this._packageDisposables.add(atom.contextMenu.add({
      'atom-text-editor': [{
        label: 'Source Control',
        submenu: [{
          label: 'Toggle Blame',
          command: 'nuclide-blame:toggle-blame',
          shouldDisplay: (event: MouseEvent) => (this._canShowBlame() || this._canHideBlame()),
        }],
      }],
    }));
    this._packageDisposables.add(
      atom.commands.add('atom-text-editor', 'nuclide-blame:toggle-blame', () => {
        if (this._canShowBlame()) {
          this._showBlame();
        } else if (this._canHideBlame()) {
          this._hideBlame();
        }
      }),
      atom.commands.add(
        'atom-text-editor',
        'nuclide-blame:hide-blame',
        () => {
          if (this._canHideBlame()) {
            this._hideBlame();
          }
        },
      ),
    );
  }

  dispose() {
    this._packageDisposables.dispose();
    this._registeredProviders.clear();
    this._textEditorToBlameGutter.clear();
    for (const disposable of this._textEditorToDestroySubscription.values()) {
      disposable.dispose();
    }
    this._textEditorToDestroySubscription.clear();
  }

  /**
   * Section: Managing Gutters
   */

  _removeBlameGutterForEditor(editor: atom$TextEditor): void {
    const blameGutter = this._textEditorToBlameGutter.get(editor);
    if (blameGutter != null) {
      blameGutter.destroy();
      this._textEditorToBlameGutter.delete(editor);
    }
  }

  _showBlameGutterForEditor(editor: atom$TextEditor): void {
    if (this._registeredProviders.size === 0) {
      atom.notifications.addInfo(PACKAGES_MISSING_MESSAGE);
      return;
    }

    let blameGutter = this._textEditorToBlameGutter.get(editor);
    if (!blameGutter) {
      let providerForEditor = null;
      for (const blameProvider of this._registeredProviders) {
        if (blameProvider.canProvideBlameForEditor(editor)) {
          providerForEditor = blameProvider;
          break;
        }
      }

      if (providerForEditor) {
        blameGutter = new BlameGutter('nuclide-blame', editor, providerForEditor);
        this._textEditorToBlameGutter.set(editor, blameGutter);
        const destroySubscription = editor.onDidDestroy(() => this._editorWasDestroyed(editor));
        this._textEditorToDestroySubscription.set(editor, destroySubscription);

        track('blame-open', {
          editorPath: editor.getPath() || '',
        });
      } else {
        atom.notifications.addInfo(
          'Could not open blame: no blame information currently available for this file.',
        );

        getLogger().info(
          'nuclide-blame: Could not open blame: no blame provider currently available for this ' +
          `file: ${String(editor.getPath())}`,
        );
      }
    }
  }

  _editorWasDestroyed(editor: atom$TextEditor): void {
    const blameGutter = this._textEditorToBlameGutter.get(editor);
    if (blameGutter) {
      blameGutter.destroy();
      this._textEditorToBlameGutter.delete(editor);
    }
    this._textEditorToDestroySubscription.delete(editor);
  }

  /**
   * Section: Managing Context Menus
   */

  _showBlame(event): void {
    return trackTiming('blame.showBlame', () => {
      const editor = atom.workspace.getActiveTextEditor();
      if (editor != null) {
        this._showBlameGutterForEditor(editor);
      }
    });
  }

  _hideBlame(event): void {
    return trackTiming('blame.hideBlame', () => {
      const editor = atom.workspace.getActiveTextEditor();
      if (editor != null) {
        this._removeBlameGutterForEditor(editor);
      }
    });
  }

  _canShowBlame(): boolean {
    const editor = atom.workspace.getActiveTextEditor();
    return !(editor != null && this._textEditorToBlameGutter.has(editor));
  }

  _canHideBlame(): boolean {
    const editor = atom.workspace.getActiveTextEditor();
    return editor != null && this._textEditorToBlameGutter.has(editor);
  }

  /**
   * Section: Consuming Services
   */

  consumeBlameProvider(provider: BlameProvider): IDisposable {
    this._registeredProviders.add(provider);
    return new Disposable(() => {
      if (this._registeredProviders) {
        this._registeredProviders.delete(provider);
      }
    });
  }

  addItemsToFileTreeContextMenu(contextMenu: FileTreeContextMenu): IDisposable {
    const contextDisposable = contextMenu.addItemToSourceControlMenu(
      {
        label: 'Toggle Blame',
        callback() {
          findBlameableNodes(contextMenu).forEach(async node => {
            const editor = await goToLocation(node.uri);
            atom.commands.dispatch(atom.views.getView(editor), 'nuclide-blame:toggle-blame');
          });
        },
        shouldDisplay() {
          return findBlameableNodes(contextMenu).length > 0;
        },
      },
      TOGGLE_BLAME_FILE_TREE_CONTEXT_MENU_PRIORITY,
    );

    this._packageDisposables.add(contextDisposable);
    // We don't need to dispose of the contextDisposable when the provider is disabled -
    // it needs to be handled by the provider itself. We only should remove it from the list
    // of the disposables we maintain.
    return new Disposable(() => this._packageDisposables.remove(contextDisposable));
  }
}

/**
 * @return list of nodes against which "Toggle Blame" is an appropriate action.
 */
function findBlameableNodes(contextMenu: FileTreeContextMenu): Array<FileTreeNode> {
  const nodes = [];
  for (const node of contextMenu.getSelectedNodes()) {
    if (node == null || !node.uri) {
      continue;
    }
    const repo = repositoryForPath(node.uri);
    if (!node.isContainer && repo != null && repo.getType() === 'hg') {
      nodes.push(node);
    }
  }
  return nodes;
}

let activation: ?Activation;

export function activate(state: ?Object): void {
  if (!activation) {
    activation = new Activation();
  }
}

export function deactivate() {
  if (activation) {
    activation.dispose();
    activation = null;
  }
}

export function consumeBlameProvider(provider: BlameProvider): IDisposable {
  invariant(activation);
  return activation.consumeBlameProvider(provider);
}

export function addItemsToFileTreeContextMenu(contextMenu: FileTreeContextMenu): IDisposable {
  invariant(activation);
  return activation.addItemsToFileTreeContextMenu(contextMenu);
}
