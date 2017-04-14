/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import {Range} from 'atom';

import {applyTextEdits} from '..';

const fakeFile = '/tmp/file.txt';

describe('applyTextEdits', () => {
  let editor: atom$TextEditor = (null: any);

  beforeEach(() => {
    waitsForPromise(async () => {
      editor = await atom.workspace.open(fakeFile);
      editor.setText('foo\nbar\nbaz\n');
    });
  });

  it('should apply a patch', () => {
    const textedit = {
      oldRange: new Range([1, 0], [1, 2]),
      newText: 'BAR',
    };

    expect(applyTextEdits(fakeFile, textedit)).toBeTruthy();
    expect(editor.getText()).toEqual('foo\nBARr\nbaz\n');
  });

  it('should accept a patch with the right old text', () => {
    const textedit = {
      oldRange: new Range([1, 0], [1, 2]),
      newText: 'BAR',
      oldText: 'ba',
    };

    expect(applyTextEdits(fakeFile, textedit)).toBeTruthy();
    expect(editor.getText()).toEqual('foo\nBARr\nbaz\n');
  });

  it('should reject a patch with the wrong old text', () => {
    const textedit = {
      oldRange: new Range([1, 0], [1, 2]),
      newText: 'BAR',
      oldText: 'b',
    };

    expect(applyTextEdits(fakeFile, textedit)).toBeFalsy();
    expect(editor.getText()).toEqual('foo\nbar\nbaz\n');
  });

  it('should reject a patch with an invalid old range', () => {
    const textedit = {
      oldRange: new Range([1, 4], [1, 4]),
      newText: 'foo',
      oldText: '',
    };

    expect(applyTextEdits(fakeFile, textedit)).toBeFalsy();
  });

  it('should accept a patch that appends to a line', () => {
    const textedit = {
      oldRange: new Range([1, 3], [1, 3]),
      newText: ';',
      oldText: '',
    };

    expect(applyTextEdits(fakeFile, textedit)).toBeTruthy();
    expect(editor.getText()).toEqual('foo\nbar;\nbaz\n');
  });

  it('should correctly apply edits on the same line', () => {
    const edits = [
      {
        oldRange: new Range([0, 0], [0, 1]),
        oldText: 'f',
        newText: 'FFF',
      },
      {
        oldRange: new Range([0, 2], [0, 3]),
        oldText: 'o',
        newText: 'OOO',
      },
    ];
    expect(applyTextEdits(fakeFile, ...edits)).toBeTruthy();
    expect(editor.getText()).toEqual('FFFoOOO\nbar\nbaz\n');
  });
});
