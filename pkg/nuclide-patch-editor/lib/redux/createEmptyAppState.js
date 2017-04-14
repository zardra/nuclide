/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import type {AppState} from '../types';

export function createEmptyAppState(): AppState {
  return {
    patchEditors: new Map(),
  };
}
