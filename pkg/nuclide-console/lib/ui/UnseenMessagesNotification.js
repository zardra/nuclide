/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import classnames from 'classnames';
import React from 'react';

type Props = {
  onClick: () => mixed,
  visible: boolean,
};

export default class NewMessagesNotification extends React.Component {
  props: Props;

  render(): React.Element<any> {
    const className = classnames(
      'nuclide-console-new-messages-notification',
      'badge',
      'badge-info',
      {
        visible: this.props.visible,
      },
    );
    return (
      <div
        className={className}
        onClick={this.props.onClick}>
        <span
          className="nuclide-console-new-messages-notification-icon icon icon-nuclicon-arrow-down"
        />
        New Messages
      </div>
    );
  }
}
