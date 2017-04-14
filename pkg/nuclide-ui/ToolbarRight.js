/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import React from 'react';

type Props = {
  children?: mixed,
};

export const ToolbarRight = (props: Props) => {
  return (
    <div className="nuclide-ui-toolbar__right">
      {props.children}
    </div>
  );
};
