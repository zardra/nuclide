/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import type {MarkedString} from './types';

import marked from 'marked';
import React from 'react';

import MarkedStringSnippet from './MarkedStringSnippet';

type Props = {
  markedStrings: Array<MarkedString>,
};

export default class MarkedStringDatatip extends React.PureComponent {
  props: Props;

  render(): React.Element<any> {
    const elements = this.props.markedStrings.map((chunk, i) => {
      if (chunk.type === 'markdown') {
        return (
          <div
            className="nuclide-datatip-marked-container"
            dangerouslySetInnerHTML={{
              __html: marked(chunk.value, {sanitize: true}),
            }}
            key={i}
          />
        );
      } else {
        return <MarkedStringSnippet key={i} {...chunk} />;
      }
    });

    return (
      <div className="nuclide-datatip-marked">
        {elements}
      </div>
    );
  }
}
