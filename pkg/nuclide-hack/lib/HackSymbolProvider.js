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
import type {
  FileResult,
  GlobalProviderType,
} from '../../nuclide-quick-open/lib/types';
import type {
  SymbolResult,
  LanguageService,
} from '../../nuclide-language-service/lib/LanguageService';

import {getHackLanguageForUri} from './HackLanguage';
import {
  collect,
  arrayCompact,
  arrayFlatten,
} from '../../commons-node/collection';
import nuclideUri from '../../commons-node/nuclideUri';
import React from 'react';


async function getHackDirectoriesByService(
  directories: Array<atom$Directory>, // top-level project directories
): Promise<Array<[LanguageService, Array<NuclideUri>]>> {
  const promises: Array<Promise<?[LanguageService, NuclideUri]>> =
    directories.map(async directory => {
      const service = await getHackLanguageForUri(directory.getPath());
      return service ? [service, directory.getPath()] : null;
    });
  const serviceDirectories: Array<?[LanguageService, NuclideUri]> =
    await Promise.all(promises);

  const results: Map<LanguageService, Array<NuclideUri>> =
    collect(arrayCompact(serviceDirectories));

  return Array.from(results.entries());
}

export const HackSymbolProvider: GlobalProviderType = {
  providerType: 'GLOBAL',
  name: 'HackSymbolProvider',
  display: {
    title: 'Hack Symbols',
    prompt: 'Search Hack symbols...',
    action: 'nuclide-hack-symbol-provider:toggle-provider',
  },

  async isEligibleForDirectories(
    directories: Array<atom$Directory>,
  ): Promise<boolean> {
    const serviceDirectories = await getHackDirectoriesByService(directories);
    const eligibilities = await Promise.all(serviceDirectories.map(
      ([service, dirs]) => service.supportsSymbolSearch(dirs),
    ));
    return eligibilities.some(e => e);
  },

  async executeQuery(
    query: string,
    directories: Array<atom$Directory>,
  ): Promise<Array<FileResult>> {
    if (query.length === 0) {
      return [];
    }

    const serviceDirectories = await getHackDirectoriesByService(directories);
    const results = await Promise.all(serviceDirectories.map(
      ([service, dirs]) => service.symbolSearch(query, dirs)));
    const flattenedResults: Array<SymbolResult> = arrayFlatten(arrayCompact(results));

    return ((flattenedResults: any): Array<FileResult>);
    // Why the weird cast? Because services are expected to return their own
    // custom type with symbol-provider-specific additional detail. We upcast it
    // now to FileResult which only has the things that Quick-Open cares about
    // like line, column, ... Later on, Quick-Open invokes getComponentForItem
    // (below) to render each result: it does a downcast so it can render
    // whatever additional details.
  },

  getComponentForItem(uncastedItem: FileResult): React.Element<any> {
    const item = ((uncastedItem: any): SymbolResult);
    const filePath = item.path;
    const filename = nuclideUri.basename(filePath);
    const name = item.name || '';

    const symbolClasses = item.icon ? `file icon icon-${item.icon}` : 'file icon no-icon';
    return (
      <div title={item.hoverText || ''}>
        <span className={symbolClasses}><code>{name}</code></span>
        <span className="omnisearch-symbol-result-filename">{filename}</span>
      </div>
    );
  },
};
