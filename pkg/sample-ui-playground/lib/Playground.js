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


import {Button} from '../../nuclide-ui/Button';
import {ButtonExamples} from '../../nuclide-ui/Button.example';
import {ProgressIndicatorExamples} from '../../nuclide-ui/ProgressIndicators.example';
import {CheckboxExamples} from '../../nuclide-ui/Checkbox.example';
import {TabExamples} from '../../nuclide-ui/Tabs.example';
import {RadioGroupExamples} from '../../nuclide-ui/RadioGroup.example';
import {TextInputExamples} from '../../nuclide-ui/TextInputs.example';
import {ToolbarExamples} from '../../nuclide-ui/Toolbar.example';
import {DiagnosticsExamples} from '../../nuclide-ui/Diagnostics.example';
import {BadgeExamples} from '../../nuclide-ui/Badge.example';
import {HighlightExamples} from '../../nuclide-ui/Highlight.example';
import {IconExamples} from '../../nuclide-ui/Icon.example';
import {TreeExamples} from '../../nuclide-ui/Tree.example';
import {ListviewExamples} from '../../nuclide-ui/ListView.example';
import {TableExamples} from '../../nuclide-ui/Table.example';
import {RelativeDateExamples} from '../../nuclide-ui/RelativeDate.example';
import {MultiRootChangedFilesViewExample} from '../../nuclide-ui/MultiRootChangedFilesView.example';
import {ToggleExamples} from '../../nuclide-ui/Toggle.example';
import {ResizableFlexContainerExamples} from '../../nuclide-ui/ResizableFlexContainer.example';
import {ModalExamples} from '../../nuclide-ui/Modal.example';
import {FileChangesExamples} from '../../nuclide-ui/FileChanges.example';
import {MessageExamples} from '../../nuclide-ui/Message.example';

const playgroundComponents = [
  MessageExamples,
  ButtonExamples,
  ModalExamples,
  ProgressIndicatorExamples,
  CheckboxExamples,
  ToggleExamples,
  TabExamples,
  ResizableFlexContainerExamples,
  RadioGroupExamples,
  TextInputExamples,
  ToolbarExamples,
  DiagnosticsExamples,
  BadgeExamples,
  HighlightExamples,
  IconExamples,
  TreeExamples,
  ListviewExamples,
  TableExamples,
  RelativeDateExamples,
  MultiRootChangedFilesViewExample,
  FileChangesExamples,
];

type ComponentSpec = {
  sectionName: string,
  description: string,
  examples: Array<{
    title: string,
    component: ReactClass<any> | () => React.Element<any>,
  }>,
};

type State = {
  collapsedSections: Set<string>,
};

export const WORKSPACE_VIEW_URI = 'atom://nuclide/ui-playground';

export class Playground extends React.Component {
  state: State;

  constructor(props: any) {
    super(props);
    (this: any)._collapseAllSections = this._collapseAllSections.bind(this);
    (this: any).renderExampleForComponent = this.renderExampleForComponent.bind(this);
    this.state = {
      collapsedSections: new Set(),
    };
  }

  getTitle(): string {
    return 'Nuclide UI Playground';
  }

  getIconName(): string {
    return 'puzzle';
  }

  getURI(): string {
    return WORKSPACE_VIEW_URI;
  }

  getDefaultLocation(): string {
    return 'center';
  }

  serialize(): mixed {
    return {
      deserializer: 'nuclide.SampleUiPlayground',
    };
  }

  _collapseAllSections(): void {
    this.setState({
      collapsedSections: new Set(playgroundComponents.map(spec => spec.sectionName)),
    });
  }

  _toggleSection(sectionName: string): void {
    const {collapsedSections} = this.state;
    if (collapsedSections.has(sectionName)) {
      collapsedSections.delete(sectionName);
    } else {
      collapsedSections.add(sectionName);
    }
    this.forceUpdate();
  }

  renderExampleForComponent(
    spec: ComponentSpec,
    index: number,
  ): React.Element<any> {
    const {
      sectionName,
      description,
      examples,
    } = spec;
    let renderedDescription;
    let flattenedExample;
    const isCollapsed = this.state.collapsedSections.has(sectionName);
    if (!isCollapsed) {
      flattenedExample = [].concat(...examples.map((example, i) => {
        const {
          title,
          component: Component,
        } = example;
        return [
          <h2 key={`${index}:${i}t`}>{title}</h2>,
          <div key={`${index}:${i}c`} className="nuclide-ui-playground-example">
            <Component />
          </div>,
        ];
      }));
      renderedDescription = <p>{description}</p>;
    }
    const h1ClassName = classnames({
      'nuclide-ui-playground-section-headline-collapsed': isCollapsed,
    });
    return (
       <section className="nuclide-ui-playground-section bordered" key={index}>
        <h1 className={h1ClassName} onClick={this._toggleSection.bind(this, sectionName)}>
          {sectionName}
        </h1>
        {renderedDescription}
        {flattenedExample}
      </section>
    );
  }

  render(): React.Element<any> {
    const renderedExamples = playgroundComponents.map(this.renderExampleForComponent);
    return (
      <div className="nuclide-ui-playground">
        <div className="nuclide-ui-playground-header">
          <Button onClick={this._collapseAllSections}>Collapse all sections</Button>
        </div>
        {renderedExamples}
      </div>
    );
  }
}
