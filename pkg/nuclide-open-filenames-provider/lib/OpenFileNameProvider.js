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
  FileResult,
  Provider,
} from '../../nuclide-quick-open/lib/types';

import {arrayCompact} from '../../commons-node/collection';
import {Matcher} from '../../nuclide-fuzzy-native';

// Returns paths of currently opened editor tabs.
function getOpenTabsMatching(query: string): Array<FileResult> {
  const matcher = new Matcher(arrayCompact(
    atom.workspace.getTextEditors()
      .map(editor => editor.getPath()),
  ));
  return matcher.match(query, {recordMatchIndexes: true})
    .map(result => ({
      path: result.value,
      score: result.score,
      matchIndexes: result.matchIndexes,
    }));
}

const OpenFileListProvider: Provider = {
  providerType: 'GLOBAL',
  name: 'OpenFileListProvider',
  debounceDelay: 0,
  display: {
    title: 'Open Files',
    prompt: 'Search open filenames...',
    action: 'nuclide-open-filenames-provider:toggle-provider',
  },

  isEligibleForDirectories(directories: Array<atom$Directory>): Promise<boolean> {
    return Promise.resolve(true);
  },

  executeQuery(query: string, directories: Array<atom$Directory>): Promise<Array<FileResult>> {
    return Promise.resolve(getOpenTabsMatching(query));
  },
};

module.exports = OpenFileListProvider;
