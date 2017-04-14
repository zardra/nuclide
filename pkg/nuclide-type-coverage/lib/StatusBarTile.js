/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import type {Observable} from 'rxjs';

import type {Result} from '../../commons-atom/ActiveEditorRegistry';

import type {CoverageProvider} from './types';
import type {CoverageResult} from './rpc-types';

import invariant from 'assert';
import React from 'react';
import {Subscription} from 'rxjs';

import {StatusBarTileComponent} from './StatusBarTileComponent';

type Props = {
  results: Observable<Result<CoverageProvider, ?CoverageResult>>,
  isActive: Observable<boolean>,
  onClick: Function,
};

type State = {
  result: ?{
    percentage: number,
    providerName: string,
  },
  pending: boolean,
  isActive: boolean,
};

export class StatusBarTile extends React.Component {
  _item: ?HTMLElement;
  _tile: ?atom$StatusBarTile;

  _percentage: ?number;

  state: State;
  props: Props;

  subscription: ?rxjs$ISubscription;

  constructor(props: Props) {
    super(props);
    this.state = {
      result: null,
      pending: false,
      isActive: false,
    };
  }

  componentDidMount(): void {
    invariant(this.subscription == null);
    const subscription = this.subscription = new Subscription();
    subscription.add(
      this.props.results.subscribe(result => this._consumeResult(result)),
    );
    subscription.add(
      this.props.isActive.subscribe(isActive => this._consumeIsActive(isActive)),
    );
  }

  componentWillUnmount(): void {
    invariant(this.subscription != null);
    this.subscription.unsubscribe();
    this.subscription = null;
    this.setState({result: null});
  }

  _consumeResult(result: Result<CoverageProvider, ?CoverageResult>): void {
    switch (result.kind) {
      case 'not-text-editor':
      case 'no-provider':
      case 'provider-error':
        this.setState({result: null});
        break;
      case 'pane-change':
      case 'edit':
      case 'save':
        this.setState({pending: true});
        break;
      case 'result':
        const coverageResult = result.result;
        this.setState({
          result: coverageResult == null ? null : {
            percentage: coverageResult.percentage,
            providerName: result.provider.displayName,
          },
          pending: false,
        });
        break;
      default:
        throw new Error(`Should handle kind ${result.kind}`);
    }
  }

  _consumeIsActive(isActive: boolean): void {
    this.setState({isActive});
  }

  render(): React.Element<any> {
    return (
      <StatusBarTileComponent {...this.state} onClick={this.props.onClick} />
    );
  }
}
