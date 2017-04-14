/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import type {HunkData, PatchData} from './types';

import nullthrows from 'nullthrows';
import parse from 'diffparser';
import {SelectedState} from './constants';

// Export an Array of diffparser$FileDiff objects to a string utilizable by the
// Mercurial edrecord extension
export function patchToString(patchData: PatchData): string {
  const lines: Array<string> = [];

  patchData.files.forEach(fileData => {
    if (fileData.selected === SelectedState.NONE) {
      return;
    }
    const fileDiff = fileData.fileDiff;
    lines.push(`diff --git a/${fileDiff.from} b/${fileDiff.to}`);
    if (!isSpecialChange(fileDiff)) {
      lines.push(`--- a/${fileDiff.from}\n+++ b/${fileDiff.to}`);
      fileDiff.chunks.forEach(hunk => {
        const hunkData = nullthrows(nullthrows(fileData.chunks).get(hunk.oldStart));
        if (hunkData.selected === SelectedState.NONE) {
          return;
        }
        lines.push(hunk.content);
        let firstChangeLocation;
        hunk.changes.forEach((change, index) => {
          if (change.type !== 'normal') {
            if (firstChangeLocation == null) {
              firstChangeLocation = index;
            }
            if (hunkData.lines[index - firstChangeLocation]) {
              lines.push(change.content);
            } else if (change.type === 'del') {
              // disabling a 'del' line replaces the '-' prefix with ' '
              lines.push(' ' + change.content.substr(1));
            }
            // Don't push disabled 'add' lines
          } else {
            lines.push(change.content);
          }
        });
      });
    }
  });

  return lines.join('\n') + '\n'; // end file with a newline
}

// Special changes only require the first line of the header be printed
// Examples of special changes: binary files, renaming files, deleting files, adding empty files
export function isSpecialChange(fileDiff: diffparser$FileDiff): boolean {
  return fileDiff.chunks.length === 0;
}

// Special changes come with annotations that will be useful to display on the FileChanges UI
export function parseWithAnnotations(diffContent: string): Array<diffparser$FileDiff> {
  const patch = parse(diffContent);

  const patchLines = diffContent.split('\n');
  let currentLine = 0;

  patch.forEach(fileDiff => {
    while (!patchLines[currentLine].startsWith('diff ')) {
      ++currentLine;
    }
    const annotationLines = [];
    while (patchLines[++currentLine].startsWith('# ')) {
      annotationLines.push(patchLines[currentLine].substr(2));
    }
    if (annotationLines.length > 0) {
      fileDiff.annotation = annotationLines.join('\n');
    }
  });
  return patch;
}

export function createPatchData(patch: Array<diffparser$FileDiff>): PatchData {
  return {
    files: new Map(patch.map(fileDiff => [fileDiff.to, {
      chunks: isSpecialChange(fileDiff)
        ? null
        : new Map(fileDiff.chunks.map(chunk => [chunk.oldStart, createHunkData(chunk)])),
      countEnabledChunks: fileDiff.chunks.length,
      countPartialChunks: 0,
      fileDiff,
      selected: SelectedState.ALL,
    }])),
  };
}

export function createHunkData(hunk: diffparser$Hunk): HunkData {
  const lines = hunk.changes.map(change => change.type !== 'normal').filter(isChange => isChange);
  return {
    countEnabledChanges: lines.length,
    lines,
    selected: SelectedState.ALL,
  };
}
