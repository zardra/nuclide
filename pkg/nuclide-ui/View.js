/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import {React, ReactDOM} from 'react-for-atom';

type Props = {
  item: Object,
};

/**
 * A React component used for rendering an item associated with a view via Atom's view registry.
 * Because we're going through Atom's ViewRegistry (which returns DOM nodes), we need to render an
 * empty element and manually attach the view (DOM element) we get from Atom.
 */
export class View extends React.Component {
  props: Props;
  _renderedItem: ?Object;

  shouldComponentUpdate(nextProps: Props): boolean {
    return this.props.item !== nextProps.item;
  }

  componentDidMount(): void {
    this._update(this.props.item);
  }

  componentDidUpdate(): void {
    this._update(this.props.item);
  }

  _update(item: ?Object): void {
    if (item === this._renderedItem) { return; }

    // Remove the current children.
    const container = ReactDOM.findDOMNode(this);
    // $FlowFixMe
    while (container.lastChild != null) {
      // $FlowFixMe
      container.removeChild(container.lastChild);
    }

    this._renderedItem = item;
    if (item == null) { return; }
    const el = atom.views.getView(item);
    // $FlowFixMe
    container.appendChild(el);
  }

  render(): React.Element<any> {
    return <nuclide-react-mount-root />;
  }
}
