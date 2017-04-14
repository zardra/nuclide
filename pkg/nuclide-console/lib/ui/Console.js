/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import type {
  DisplayableRecord,
  Executor,
  OutputProvider,
  RecordHeightChangeHandler,
  Source,
} from '../types';

import debounce from '../../../commons-node/debounce';
import React from 'react';
import OutputTable from './OutputTable';
import ConsoleHeader from './ConsoleHeader';
import InputArea from './InputArea';
import PromptButton from './PromptButton';
import UnseenMessagesNotification from './UnseenMessagesNotification';
import invariant from 'assert';
import shallowEqual from 'shallowequal';

type Props = {
  displayableRecords: Array<DisplayableRecord>,
  history: Array<string>,
  clearRecords: () => void,
  execute: (code: string) => void,
  currentExecutor: ?Executor,
  executors: Map<string, Executor>,
  invalidFilterInput: boolean,
  enableRegExpFilter: boolean,
  selectedSourceIds: Array<string>,
  selectExecutor: (executorId: string) => void,
  selectSources: (sourceIds: Array<string>) => void,
  sources: Array<Source>,
  toggleRegExpFilter: () => void,
  updateFilterText: (filterText: string) => void,
  getProvider: (id: string) => ?OutputProvider,
  onDisplayableRecordHeightChange: RecordHeightChangeHandler,
};

type State = {
  unseenMessages: boolean,
};

export default class Console extends React.Component {
  props: Props;
  state: State;

  _isScrolledNearBottom: boolean;
  _outputTable: ?OutputTable;

  constructor(props: Props) {
    super(props);
    this.state = {
      unseenMessages: false,
    };
    this._isScrolledNearBottom = false;
    (this: any)._getExecutor = this._getExecutor.bind(this);
    (this: any)._getProvider = this._getProvider.bind(this);
    (this: any)._handleOutputTable = this._handleOutputTable.bind(this);
    (this: any)._handleScroll = this._handleScroll.bind(this);
    (this: any)._handleScrollEnd = debounce(this._handleScrollEnd, 100);
    (this: any)._scrollToBottom = this._scrollToBottom.bind(this);
  }

  componentDidUpdate(prevProps: Props): void {
    // If records are added while we're scrolled to the bottom (or very very close, at least),
    // automatically scroll.
    if (this._isScrolledNearBottom &&
      this.props.displayableRecords.length > prevProps.displayableRecords.length) {
      this._scrollToBottom();
    }
  }

  _renderPromptButton(): React.Element<any> {
    invariant(this.props.currentExecutor != null);
    const {currentExecutor} = this.props;
    const options = Array.from(this.props.executors.values())
      .map(executor => ({
        id: executor.id,
        label: executor.name,
      }));
    return (
      <PromptButton
        value={currentExecutor.id}
        onChange={this.props.selectExecutor}
        options={options}
        children={currentExecutor.name}
      />
    );
  }

  _isScrolledToBottom(offsetHeight: number, scrollHeight: number, scrollTop: number): boolean {
    return scrollHeight - (offsetHeight + scrollTop) < 5;
  }

  componentWillReceiveProps(nextProps: Props): void {
    if (nextProps.displayableRecords.length > this.props.displayableRecords.length) {
      // If we receive new messages after we've scrolled away from the bottom, show the
      // "new messages" notification.
      if (!this._isScrolledNearBottom) {
        this.setState({unseenMessages: true});
      }
    }
  }

  shouldComponentUpdate(nextProps: Props, nextState: State): boolean {
    return !shallowEqual(this.props, nextProps) || !shallowEqual(this.state, nextState);
  }

  _getExecutor(id: string): ?Executor {
    return this.props.executors.get(id);
  }

  _getProvider(id: string): ?OutputProvider {
    return this.props.getProvider(id);
  }

  render(): ?React.Element<any> {
    return (
      <div className="nuclide-console">
        <ConsoleHeader
          clear={this.props.clearRecords}
          invalidFilterInput={this.props.invalidFilterInput}
          enableRegExpFilter={this.props.enableRegExpFilter}
          selectedSourceIds={this.props.selectedSourceIds}
          sources={this.props.sources}
          toggleRegExpFilter={this.props.toggleRegExpFilter}
          onFilterTextChange={this.props.updateFilterText}
          onSelectedSourcesChange={this.props.selectSources}
        />
        {/*
          We need an extra wrapper element here in order to have the new messages notification stick
          to the bottom of the scrollable area (and not scroll with it).
        */}
        <div className="nuclide-console-body">
          <div className="nuclide-console-scroll-pane-wrapper">
            <OutputTable
              ref={this._handleOutputTable}
              displayableRecords={this.props.displayableRecords}
              showSourceLabels={this.props.selectedSourceIds.length > 1}
              getExecutor={this._getExecutor}
              getProvider={this._getProvider}
              onScroll={this._handleScroll}
              onDisplayableRecordHeightChange={this.props.onDisplayableRecordHeightChange}
            />
            <UnseenMessagesNotification
              visible={this.state.unseenMessages}
              onClick={this._scrollToBottom}
            />
          </div>
          {this._renderPrompt()}
        </div>
      </div>
    );
  }

  _renderPrompt(): ?React.Element<any> {
    const {currentExecutor} = this.props;
    if (currentExecutor == null) {
      return;
    }
    return (
      <div className="nuclide-console-prompt">
        {this._renderPromptButton()}
        <InputArea
          scopeName={currentExecutor.scopeName}
          onSubmit={this.props.execute}
          history={this.props.history}
        />
      </div>
    );
  }

  _handleScroll(offsetHeight: number, scrollHeight: number, scrollTop: number): void {
    this._handleScrollEnd(offsetHeight, scrollHeight, scrollTop);
  }

  _handleScrollEnd(offsetHeight: number, scrollHeight: number, scrollTop: number): void {
    this._isScrolledNearBottom = this._isScrolledToBottom(offsetHeight, scrollHeight, scrollTop);
    this.setState({unseenMessages: this.state.unseenMessages && !this._isScrolledNearBottom});
  }

  _handleOutputTable(ref: OutputTable): void {
    this._outputTable = ref;
  }

  _scrollToBottom(): void {
    if (!this._outputTable) {
      return;
    }
    this._outputTable.scrollToBottom();
    this.setState({unseenMessages: false});
  }
}
