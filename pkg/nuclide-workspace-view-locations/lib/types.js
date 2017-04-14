/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

export type SerializedPanelLocation = {
  deserializer: 'PanelLocation',
  data: {
    paneContainer: ?Object,
    size: ?number,
    active: boolean,
    visible?: boolean, // For legacy compat (<= v0.206)
  },
};

export type PanelLocationId =
  'top'
  | 'right'
  | 'bottom'
  | 'left';
