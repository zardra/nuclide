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
  filteredRecordCount: number,
  onReset: () => void,
};

export default class FilteredMessagesReminder extends React.Component {
  props: Props;

  constructor(props: Props) {
    super(props);
    (this: any).handleClick = this.handleClick.bind(this);
  }

  handleClick(e: SyntheticEvent) {
    e.preventDefault();
    this.props.onReset();
  }

  render(): ?React.Element<any> {
    const {filteredRecordCount} = this.props;
    if (filteredRecordCount === 0) {
      return null;
    }

    return (
      <div className="nuclide-console-filtered-reminder">
        <div style={{flex: 1}}>
          <pre>
            {filteredRecordCount}{' '}
            {filteredRecordCount === 1 ? 'message is' : 'messages are'}{' '}
            hidden by filters.
          </pre>
        </div>
        <a href="#" onClick={this.handleClick}>
          <pre>Show all messages.</pre>
        </a>
      </div>
    );
  }
}
