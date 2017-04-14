/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import type {Datatip} from './types';

import React from 'react';
import {maybeToString} from '../../commons-node/string';
import MarkedStringDatatip from './MarkedStringDatatip';

export const DATATIP_ACTIONS = Object.freeze({
  PIN: 'PIN',
  CLOSE: 'CLOSE',
});

const IconsForAction = {
  [DATATIP_ACTIONS.PIN]: 'pin',
  [DATATIP_ACTIONS.CLOSE]: 'x',
};

type DatatipComponentProps = {
  action: string,
  actionTitle: string,
  className?: string,
  datatip: Datatip,
  onActionClick: Function,
};

export class DatatipComponent extends React.Component {
  props: DatatipComponentProps;

  constructor(props: DatatipComponentProps) {
    super(props);
    (this: any).handleActionClick = this.handleActionClick.bind(this);
  }

  handleActionClick(event: SyntheticEvent): void {
    this.props.onActionClick();
  }

  render(): React.Element<any> {
    const {
      className,
      action,
      actionTitle,
      datatip,
      ...props
    } = this.props;
    delete props.onActionClick;
    let actionButton;
    if (action != null && IconsForAction[action] != null) {
      const actionIcon = IconsForAction[action];
      actionButton = (
        <div
          className={`nuclide-datatip-pin-button icon-${actionIcon}`}
          onClick={this.handleActionClick}
          title={actionTitle}
        />
      );
    }
    let content;
    if (datatip.component != null) {
      content = <datatip.component />;
    } else if (datatip.markedStrings != null) {
      content = <MarkedStringDatatip markedStrings={datatip.markedStrings} />;
    }
    return (
      <div
        className={`${maybeToString(className)} nuclide-datatip-container`}
        {...props}>
        <div className="nuclide-datatip-content">
          {content}
        </div>
        {actionButton}
      </div>
    );
  }
}
