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

// Globally unique ID used as the "name" attribute to group radio inputs.
let uid = 0;

type Props = {
  optionLabels: Array<React.Element<any>>,
  selectedIndex: number,
  onSelectedChange(selectedIndex: number): void,
};

type State = {
  uid: number,
};

/**
 * A managed radio group component. Accepts arbitrary React elements as labels.
 */
export default class RadioGroup extends React.Component {
  props: Props;
  state: State;

  static defaultProps = {
    optionLabels: [],
    onSelectedChange: (selectedIndex: number) => {},
    selectedIndex: 0,
  };

  constructor(props: Props) {
    super(props);
    this.state = {
      uid: uid++,
    };
  }

  render(): React.Element<any> {
    const {onSelectedChange} = this.props;
    const checkboxes = this.props.optionLabels.map((labelContent, i) => {
      const id = 'nuclide-radiogroup-' + uid + '-' + i;
      return (
        <div key={i}>
          <input
            className="input-radio"
            type="radio"
            checked={i === this.props.selectedIndex}
            name={'radiogroup-' + this.state.uid}
            id={id}
            onChange={() => { onSelectedChange(i); }}
          />
          <label
            className="input-label nuclide-ui-radiogroup-label"
            htmlFor={id}>
            {labelContent}
          </label>
        </div>
      );
    });
    return (
      <div>
        {checkboxes}
      </div>
    );
  }
}
