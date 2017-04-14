/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */


import {FileTreeNode} from '../lib/FileTreeNode';
import Immutable from 'immutable';
import {WorkingSet} from '../../nuclide-working-sets-common';


const CONF = {
  vcsStatuses: new Immutable.Map(),
  fileChanges: new Immutable.Map(),
  workingSet: new WorkingSet(),
  editedWorkingSet: new WorkingSet(),
  hideIgnoredNames: true,
  isCalculatingChanges: false,
  excludeVcsIgnoredPaths: true,
  ignoredPatterns: new Immutable.Set(),
  repositories: new Immutable.Set(),
  usePreviewTabs: true,
  isEditingWorkingSet: false,
  openFilesWorkingSet: new WorkingSet(),
  reposByRoot: {},
};


describe('FileTreeNode', () => {
  it('properly sets the default properties', () => {
    const node = new FileTreeNode({
      uri: '/abc/def',
      rootUri: '/abc/',
    }, CONF);

    expect(node.uri).toBe('/abc/def');
    expect(node.rootUri).toBe('/abc/');
    expect(node.isExpanded).toBe(false);
    expect(node.isSelected).toBe(false);
    expect(node.isLoading).toBe(false);
    expect(node.isCwd).toBe(false);
    expect(node.isTracked).toBe(false);
    expect(node.children.isEmpty()).toBe(true);
    expect(node.highlightedText).toEqual('');
    expect(node.matchesFilter).toBeTruthy();
  });

  it('properly sets the supplied properties', () => {
    const children = new Immutable.OrderedMap();
    const node = new FileTreeNode({
      uri: '/abc/def',
      rootUri: '/abc/',
      isExpanded: true,
      isSelected: true,
      isLoading: true,
      isCwd: true,
      isTracked: true,
      children,
    }, CONF);

    expect(node.uri).toBe('/abc/def');
    expect(node.rootUri).toBe('/abc/');
    expect(node.isExpanded).toBe(true);
    expect(node.isSelected).toBe(true);
    expect(node.isLoading).toBe(true);
    expect(node.isCwd).toBe(true);
    expect(node.isTracked).toBe(true);
    expect(node.children).toBe(children);
    expect(node.highlightedText).toEqual('');
    expect(node.matchesFilter).toBeTruthy();
  });

  it('derives properties', () => {
    const node = new FileTreeNode({
      uri: '/abc/def/ghi',
      rootUri: '/abc/',
    }, CONF);

    // Derived
    expect(node.name).toBe('ghi');
    expect(node.relativePath).toBe('def/ghi');
    expect(node.localPath).toBe('/abc/def/ghi');
    expect(node.isContainer).toBe(false);
    expect(node.shouldBeShown).toBe(true);
    expect(node.checkedStatus).toBe('clear');
    expect(node.shouldBeSoftened).toBe(false);
    expect(node.highlightedText).toEqual('');
    expect(node.matchesFilter).toBeTruthy();
  });

  it('preserves instance on non-modifying updates', () => {
    const child1 = new FileTreeNode({
      uri: '/abc/def/ghi1',
      rootUri: '/abc/',
    }, CONF);

    const child2 = new FileTreeNode({
      uri: '/abc/def/ghi2',
      rootUri: '/abc/',
    }, CONF);

    const children = new Immutable.OrderedMap([
      [child1.name, child1],
      [child2.name, child2],
    ]);
    const node = new FileTreeNode({
      uri: '/abc/def',
      rootUri: '/abc/',
      isExpanded: true,
      isSelected: false,
      isLoading: false,
      isCwd: true,
      isTracked: false,
      children,
    }, CONF);

    expect(node.isExpanded).toBe(true);
    let updatedNode = node.setIsExpanded(true);
    expect(updatedNode).toBe(node);
    updatedNode = node.setIsSelected(false);
    expect(updatedNode).toBe(node);
    updatedNode = node.setIsLoading(false);
    expect(updatedNode).toBe(node);
    updatedNode = node.setIsCwd(true);
    expect(updatedNode).toBe(node);
    updatedNode = node.setIsTracked(false);
    expect(updatedNode).toBe(node);
    updatedNode = node.setChildren(new Immutable.OrderedMap(children));
    expect(updatedNode).toBe(node);
    updatedNode = node.setRecursive(null, child => child.setIsSelected(false));
    expect(updatedNode).toBe(node);
    updatedNode = node.updateChild(child1.setIsSelected(false));
    expect(updatedNode).toBe(node);
    updatedNode = node.set({
      isExpanded: true,
      isSelected: false,
      isLoading: false,
      isCwd: true,
      isTracked: false,
      children,
    });
    expect(updatedNode).toBe(node);

    updatedNode = node.updateChild(child2.setIsSelected(true));
    expect(updatedNode).not.toBe(node);
  });

  it('finds nodes', () => {
    const rootUri = '/r/';
    const nodeABC = new FileTreeNode({uri: '/r/A/B/C/', rootUri}, CONF);
    const nodeABD = new FileTreeNode({uri: '/r/A/B/D/', rootUri}, CONF);
    let children = FileTreeNode.childrenFromArray([nodeABC, nodeABD]);
    const nodeAB = new FileTreeNode({uri: '/r/A/B/', rootUri, children}, CONF);
    children = FileTreeNode.childrenFromArray([nodeAB]);
    const nodeA = new FileTreeNode({uri: '/r/A/', rootUri, children}, CONF);
    const nodeB = new FileTreeNode({uri: '/r/B/', rootUri}, CONF);
    children = FileTreeNode.childrenFromArray([nodeA, nodeB]);
    const root = new FileTreeNode({uri: '/r/', rootUri, children}, CONF);

    expect(root.find('/r/')).toBe(root);
    expect(root.find('/r/A/')).toBe(nodeA);
    expect(root.find('/r/B/')).toBe(nodeB);
    expect(root.find('/r/A/B/')).toBe(nodeAB);
    expect(root.find('/r/A/B/C/')).toBe(nodeABC);
    expect(root.find('/r/A/B/D/')).toBe(nodeABD);

    expect(root.findDeepest('/r/A/B/E/')).toBe(nodeAB);
    expect(root.findDeepest('/r/A/B/C/E/')).toBe(nodeABC);
    expect(root.findDeepest('/r/B/B/C/E/')).toBe(nodeB);
    expect(root.findDeepest('/r/C/B/C/E/')).toBe(root);

    expect(root.find('/r/A/B/E/')).toBe(null);
    expect(root.findDeepest('/nonRoot/C/B/C/E/')).toBe(null);
  });
});
