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
import {Button} from './Button';
import {Modal} from './Modal';


class ModalExample extends React.Component {
  state: {isModalShown: boolean};

  constructor(props: void) {
    super(props);
    this.state = {isModalShown: false};
    (this: any)._showModal = this._showModal.bind(this);
    (this: any)._hideModal = this._hideModal.bind(this);
  }

  _showModal(): void {
    this.setState({isModalShown: true});
  }

  _hideModal(): void {
    this.setState({isModalShown: false});
  }

  render(): React.Element<any> {
    const {isModalShown} = this.state;
    const modal = isModalShown
      ? (
        <Modal onDismiss={this._hideModal}>
          <div>I'm a modal. You can add any content you like.</div>
          <Button onClick={this._hideModal}>hide modal</Button>
        </Modal>
      )
      : null;
    return (
      <div>
        <Button onClick={this._showModal}>show modal</Button>
        {modal}
      </div>
    );
  }
}

export const ModalExamples = {
  sectionName: 'Modal',
  description: 'Overlays that cover the entire screen. ',
  examples: [
    {
      title: 'Click the button to toggle a modal:',
      component: ModalExample,
    },
  ],
};
