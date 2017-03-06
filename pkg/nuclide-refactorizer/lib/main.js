/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

/*
 * WARNING: This package is still experimental and in early development. Use it at your own risk.
 */

import type {TextEdit} from '../../nuclide-textedit/lib/rpc-types';

import type {
  Store,
} from './types';

import type {NuclideUri} from '../../commons-node/nuclideUri';

import {Disposable} from 'atom';
import invariant from 'assert';

import ProviderRegistry from '../../commons-atom/ProviderRegistry';
import createPackage from '../../commons-atom/createPackage';
import observeGrammarForTextEditors from '../../commons-atom/observe-grammar-for-text-editors';
import {bufferPositionForMouseEvent} from '../../commons-atom/mouse-to-position';
import UniversalDisposable from '../../commons-node/UniversalDisposable';

import * as Actions from './refactorActions';
import {getStore} from './refactorStore';
import {initRefactorUIs} from './refactorUIs';

export type RenameRefactorKind = 'rename';
export type FreeformRefactorKind = 'freeform';

export type RefactorKind = RenameRefactorKind | FreeformRefactorKind;

export type RenameRefactoring = {
  kind: RenameRefactorKind,
  symbolAtPoint: {
    text: string,
    range: atom$Range,
  },
};

export type FreeformEnumValue = {
  value: string,
  description: string,
};

// Factoring out `description` confuses Flow when filtering on the type.
export type FreeformRefactoringArgument =
  | {
      type: 'string',
      description: string,
      default?: string,
    }
  | {
      type: 'boolean',
      description: string,
      default?: boolean,
    }
  | {
      type: 'enum',
      description: string,
      values: Array<FreeformEnumValue>,
      default?: string,
    };

// A freeform refactoring type.
// This allows providers to define completely new refactoring commands,
// as well as ask for arbitrary arguments to the refactoring command.
export type FreeformRefactoring = {
  kind: FreeformRefactorKind,
  // Unique identifier which will be used in the request.
  id: string,
  // Display name of the refactoring.
  name: string,
  // User-friendly description of what the refactoring does.
  description: string,
  // Full affected range of the refactoring.
  range: atom$Range,
  // Additional arguments to be requested from the user.
  // The keys should be unique identifiers, which will be used in the request.
  args: Map<string, FreeformRefactoringArgument>,
  // Providers can return disabled refactorings to improve discoverability.
  disabled?: boolean,
};

export type AvailableRefactoring = RenameRefactoring | FreeformRefactoring;

export type RenameRequest = {
  kind: RenameRefactorKind,
  editor: atom$TextEditor,
  originalPoint: atom$Point,
  symbolAtPoint: {
    text: string,
    range: atom$Range,
  },
  newName: string,
};

export type FreeformRefactorRequest = {
  kind: FreeformRefactorKind,
  editor: atom$TextEditor,
  originalPoint: atom$Point,
  // Echoes FreeformRefactoring.id.
  id: string,
  // Echoes FreeformRefactoring.range.
  range: atom$Range,
  // Arguments provided by the user.
  args: Map<string, mixed>,
};

export type RefactorRequest = RenameRequest | FreeformRefactorRequest;

export type RefactorResponse = {
  edits: Map<NuclideUri, Array<TextEdit>>,
};

export type RefactorProvider = {
  priority: number,
  grammarScopes: Array<string>,

  refactoringsAtPoint(
    editor: atom$TextEditor,
    point: atom$Point,
  ): Promise<Array<AvailableRefactoring>>,
  refactor(request: RefactorRequest): Promise<?RefactorResponse>,
};

const CONTEXT_MENU_CLASS = 'enable-nuclide-refactorizer';

class Activation {
  _disposables: UniversalDisposable;
  _store: Store;
  _providerRegistry: ProviderRegistry<RefactorProvider>;

  constructor() {
    this._providerRegistry = new ProviderRegistry();

    this._store = getStore(this._providerRegistry);

    let lastMouseEvent = null;
    this._disposables = new UniversalDisposable(
      initRefactorUIs(this._store),
      atom.commands.add('atom-workspace', 'nuclide-refactorizer:refactorize', () => {
        this._store.dispatch(Actions.open('generic'));
      }),
      atom.commands.add(
        'atom-text-editor',
        // We don't actually want people calling this directly.
        // eslint-disable-next-line nuclide-internal/atom-commands
        'nuclide-refactorizer:refactorize-from-context-menu',
        () => {
          const mouseEvent = lastMouseEvent;
          lastMouseEvent = null;
          invariant(
            mouseEvent != null,
            'No mouse event found. Do not invoke this command directly. ' +
            'If you did use the context menu, please report this issue.',
          );
          const editor = atom.workspace.getActiveTextEditor();
          invariant(editor != null);
          const bufferPosition = bufferPositionForMouseEvent(mouseEvent, editor);
          editor.setCursorBufferPosition(bufferPosition);

          this._store.dispatch(Actions.open('generic'));
        },
      ),
      atom.contextMenu.add({
        'atom-text-editor:not(.mini).enable-nuclide-refactorizer': [
          {
            label: 'Refactor',
            command: 'nuclide-refactorizer:refactorize-from-context-menu',
            created: event => { lastMouseEvent = event; },
          },
        ],
      }),
      atom.commands.add('atom-workspace', 'nuclide-refactorizer:rename', () => {
        this._store.dispatch(Actions.open('rename'));
      }),
      observeGrammarForTextEditors(editor => this._addContextMenuIfEligible(editor)),
    );
  }

  dispose() {
    this._disposables.dispose();
  }

  _addContextMenuIfEligible(editor: atom$TextEditor): void {
    const element = atom.views.getView(editor);
    if (this._providerRegistry.getProviderForEditor(editor) != null) {
      element.classList.add(CONTEXT_MENU_CLASS);
    } else {
      element.classList.remove(CONTEXT_MENU_CLASS);
    }
  }

  _checkAllEditorContextMenus(): void {
    atom.workspace.getTextEditors().forEach(editor => this._addContextMenuIfEligible(editor));
  }

  consumeRefactorProvider(provider: RefactorProvider): IDisposable {
    this._providerRegistry.addProvider(provider);
    this._checkAllEditorContextMenus();
    return new Disposable(() => {
      this._providerRegistry.removeProvider(provider);
      this._checkAllEditorContextMenus();
    });
  }
}

createPackage(module.exports, Activation);
