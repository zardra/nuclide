/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import type {NuclideUri} from '../../commons-node/nuclideUri';
import type {DiagnosticMessage} from '../../nuclide-diagnostics-common';

import DiagnosticsPane from './DiagnosticsPane';
import {Checkbox} from '../../nuclide-ui/Checkbox';
import {Toolbar} from '../../nuclide-ui/Toolbar';
import {ToolbarCenter} from '../../nuclide-ui/ToolbarCenter';
import {ToolbarLeft} from '../../nuclide-ui/ToolbarLeft';
import {ToolbarRight} from '../../nuclide-ui/ToolbarRight';
import React from 'react';
import {
  Button,
  ButtonSizes,
} from '../../nuclide-ui/Button';
import {track} from '../../nuclide-analytics';

type Props = {
  diagnostics: Array<DiagnosticMessage>,
  pathToActiveTextEditor: ?NuclideUri,
  filterByActiveTextEditor: boolean,
  onFilterByActiveTextEditorChange: (isChecked: boolean) => mixed,
  warnAboutLinter: boolean,
  disableLinter: () => mixed,
  showTraces: boolean,
  onShowTracesChange: (isChecked: boolean) => mixed,
};

/**
 * Dismissable panel that displays the diagnostics from nuclide-diagnostics-store.
 */
export default class DiagnosticsPanel extends React.Component {
  props: Props;

  constructor(props: Props) {
    super(props);
    (this: any)._onShowTracesChange =
      this._onShowTracesChange.bind(this);
    (this: any)._onFilterByActiveTextEditorChange =
      this._onFilterByActiveTextEditorChange.bind(this);
    (this: any)._openAllFilesWithErrors =
      this._openAllFilesWithErrors.bind(this);
  }

  render(): React.Element<any> {
    let warningCount: number = 0;
    let errorCount = 0;
    let {diagnostics} = this.props;
    const {showTraces} = this.props;
    if (this.props.filterByActiveTextEditor) {
      const pathToFilterBy = this.props.pathToActiveTextEditor;
      if (pathToFilterBy !== null) {
        diagnostics = diagnostics.filter(
          diagnostic => diagnostic.scope === 'file' && diagnostic.filePath === pathToFilterBy,
        );
      } else {
        // Current pane is not a text editor; do not show diagnostics.
        diagnostics = [];
      }
    }
    diagnostics.forEach(diagnostic => {
      if (diagnostic.type === 'Error') {
        ++errorCount;
      } else if (diagnostic.type === 'Warning') {
        ++warningCount;
      }
    });

    let linterWarning = null;
    if (this.props.warnAboutLinter) {
      linterWarning = (
        <Toolbar>
          <ToolbarCenter>
            <span className="inline-block highlight-info">
              nuclide-diagnostics is not compatible with the linter package. We recommend that
              you&nbsp;<a onClick={this.props.disableLinter}>disable the linter package</a>.&nbsp;
              <a href="http://nuclide.io/docs/advanced-topics/linter-package-compatibility/">
              Learn More</a>.
            </span>
          </ToolbarCenter>
        </Toolbar>
      );
    }

    const errorSpanClassName = `inline-block ${errorCount > 0 ? 'text-error' : ''}`;
    const warningSpanClassName = `inline-block ${warningCount > 0 ? 'text-warning' : ''}`;

    return (
      <div style={{display: 'flex', flex: 1, flexDirection: 'column'}}>
        {linterWarning}
        <Toolbar location="top">
          <ToolbarLeft>
            <span className={errorSpanClassName}>
              Errors: {errorCount}
            </span>
            <span className={warningSpanClassName}>
              Warnings: {warningCount}
            </span>
          </ToolbarLeft>
          <ToolbarRight>
            <span className="inline-block">
              <Checkbox
                checked={this.props.showTraces}
                label="Full description"
                onChange={this._onShowTracesChange}
              />
            </span>
            <span className="inline-block">
              <Checkbox
                checked={this.props.filterByActiveTextEditor}
                label="Current file only"
                onChange={this._onFilterByActiveTextEditorChange}
              />
            </span>
            <Button
              onClick={this._openAllFilesWithErrors}
              size={ButtonSizes.SMALL}
              disabled={diagnostics.length === 0}
              className="inline-block"
              title="Open All">
              Open All
            </Button>
          </ToolbarRight>
        </Toolbar>
        <DiagnosticsPane
          showFileName={!this.props.filterByActiveTextEditor}
          diagnostics={diagnostics}
          showTraces={showTraces}
        />
      </div>
    );
  }

  _onShowTracesChange(isChecked: boolean) {
    track('diagnostics-panel-toggle-show-traces', {isChecked: isChecked.toString()});
    this.props.onShowTracesChange.call(null, isChecked);
  }

  _onFilterByActiveTextEditorChange(isChecked: boolean) {
    track('diagnostics-panel-toggle-current-file', {isChecked: isChecked.toString()});
    this.props.onFilterByActiveTextEditorChange.call(null, isChecked);
  }

  _openAllFilesWithErrors() {
    atom.commands.dispatch(
      atom.views.getView(atom.workspace),
      'nuclide-diagnostics-ui:open-all-files-with-errors',
    );
  }
}
