/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import type {FileChangeStatusValue} from '../../nuclide-vcs-base';
import type React from 'react';

import FileTreeDispatcher, {ActionTypes} from './FileTreeDispatcher';
import FileTreeHelpers from './FileTreeHelpers';
import FileTreeHgHelpers from './FileTreeHgHelpers';
import {FileTreeNode} from './FileTreeNode';
import Immutable from 'immutable';
import {Emitter} from 'atom';
import {HgStatusToFileChangeStatus} from '../../nuclide-vcs-base';
import {matchesFilter} from './FileTreeFilterHelper';
import {Minimatch} from 'minimatch';
import {repositoryForPath} from '../../nuclide-vcs-base';
import {nextAnimationFrame} from '../../commons-node/observable';
import {StatusCodeNumber} from '../../nuclide-hg-rpc/lib/hg-constants';
import {getLogger} from '../../nuclide-logging';
import {WorkingSet} from '../../nuclide-working-sets-common';
import {track} from '../../nuclide-analytics';
import nuclideUri from '../../commons-node/nuclideUri';
import {RangeKey, SelectionRange, RangeUtil} from './FileTreeSelectionRange';

// Used to ensure the version we serialized is the same version we are deserializing.
const VERSION = 1;

import type {FileTreeAction} from './FileTreeDispatcher';
import type {Directory} from './FileTreeHelpers';
import type {NuclideUri} from '../../commons-node/nuclideUri';
import type {WorkingSetsStore} from '../../nuclide-working-sets/lib/types';
import type {StatusCodeNumberValue} from '../../nuclide-hg-rpc/lib/HgService';

type ChangeListener = () => mixed;

export type ExportStoreData = {
  childKeyMap: {[key: string]: Array<string>},
  expandedKeysByRoot: {[key: string]: Array<string>},
  rootKeys: Array<string>,
  selectedKeysByRoot: {[key: string]: Array<string>},
  version: number,
  openFilesExpanded?: boolean,
  uncommittedChangesExpanded?: boolean,
};

export type StoreConfigData = {
    vcsStatuses: Immutable.Map<NuclideUri, {[path: NuclideUri]: StatusCodeNumberValue}>,
    workingSet: WorkingSet,
    hideIgnoredNames: boolean,
    isCalculatingChanges: boolean,
    excludeVcsIgnoredPaths: boolean,
    ignoredPatterns: Immutable.Set<Minimatch>,
    usePreviewTabs: boolean,
    isEditingWorkingSet: boolean,
    openFilesWorkingSet: WorkingSet,
    reposByRoot: {[rootUri: NuclideUri]: atom$Repository},
    editedWorkingSet: WorkingSet,
    fileChanges: Immutable.Map<NuclideUri, Immutable.Map<NuclideUri, FileChangeStatusValue>>,
};

export type NodeCheckedStatus = 'checked' | 'clear' | 'partial';


export const DEFAULT_CONF = {
  vcsStatuses: new Immutable.Map(),
  workingSet: new WorkingSet(),
  editedWorkingSet: new WorkingSet(),
  hideIgnoredNames: true,
  isCalculatingChanges: false,
  excludeVcsIgnoredPaths: true,
  ignoredPatterns: new Immutable.Set(),
  usePreviewTabs: false,
  isEditingWorkingSet: false,
  openFilesWorkingSet: new WorkingSet(),
  reposByRoot: {},
  fileChanges: new Immutable.Map(),
};

let instance: ?Object;

/**
 * Implements the Flux pattern for our file tree. All state for the file tree will be kept in
 * FileTreeStore and the only way to update the store is through methods on FileTreeActions. The
 * dispatcher is a mechanism through which FileTreeActions interfaces with FileTreeStore.
 */
export class FileTreeStore {
  roots: Immutable.OrderedMap<NuclideUri, FileTreeNode>;
  openFilesExpanded: boolean;
  uncommittedChangesExpanded: boolean;

  _conf: StoreConfigData; // The configuration for the file-tree. Avoid direct writing.
  _workingSetsStore: ?WorkingSetsStore;
  _usePrefixNav: boolean;
  _isLoadingMap: Immutable.Map<NuclideUri, Promise<void>>;
  _repositories: Immutable.Set<atom$Repository>;
  _fileChanges: Immutable.Map<NuclideUri, Map<NuclideUri, FileChangeStatusValue>>;

  _dispatcher: FileTreeDispatcher;
  _emitter: Emitter;
  _logger: any;
  _animationFrameRequestSubscription: ?rxjs$Subscription;
  _suppressChanges: boolean;
  _cwdKey: ?NuclideUri;
  _filter: string;
  _extraProjectSelectionContent: Immutable.List<React.Element<any>>;
  _selectionRange: ?SelectionRange;

  static getInstance(): FileTreeStore {
    if (!instance) {
      instance = new FileTreeStore();
    }
    return instance;
  }

  static dispose(): void {
    if (instance != null) {
      instance.dispose();
    }

    instance = null;
  }

  constructor() {
    this.roots = new Immutable.OrderedMap();
    this._dispatcher = FileTreeDispatcher.getInstance();
    this._emitter = new Emitter();
    this._dispatcher.register(this._onDispatch.bind(this));
    this._logger = getLogger();
    this._fileChanges = new Immutable.Map();

    this._usePrefixNav = false;
    this._isLoadingMap = new Immutable.Map();
    this._repositories = new Immutable.Set();

    this._conf = DEFAULT_CONF;
    this._suppressChanges = false;
    this._filter = '';
    this._extraProjectSelectionContent = new Immutable.List();
    this.openFilesExpanded = true;
    this.uncommittedChangesExpanded = true;
    this._selectionRange = null;
  }

  /**
   * TODO: Move to a [serialization class][1] and use the built-in versioning mechanism. This might
   * need to be done one level higher within main.js.
   *
   * [1]: https://atom.io/docs/latest/behind-atom-serialization-in-atom
   */
  exportData(): ExportStoreData {
    const childKeyMap = {};
    const expandedKeysByRoot = {};
    const selectedKeysByRoot = {};

    this.roots.forEach(root => {
      const expandedKeys = [];
      const selectedKeys = [];

      // Grab the data of only the expanded portion of the tree.
      root.traverse(
        node => {
          if (node.isSelected) {
            selectedKeys.push(node.uri);
          }

          if (!node.isExpanded) {
            return false;
          }

          expandedKeys.push(node.uri);

          if (!node.children.isEmpty()) {
            childKeyMap[node.uri] = node.children.map(child => child.uri).toArray();
          }

          return true;
        },
      );

      expandedKeysByRoot[root.uri] = expandedKeys;
      selectedKeysByRoot[root.uri] = selectedKeys;
    });

    const rootKeys = this.roots.map(root => root.uri).toArray();

    return {
      version: VERSION,
      childKeyMap,
      expandedKeysByRoot,
      rootKeys,
      selectedKeysByRoot,
      openFilesExpanded: this.openFilesExpanded,
      uncommittedChangesExpanded: this.uncommittedChangesExpanded,
    };
  }

  /**
   * Imports store data from a previous export.
   */
  loadData(data: ExportStoreData): void {
    // Ensure we are not trying to load data from an earlier version of this package.
    if (data.version !== VERSION) {
      return;
    }

    const buildNode = (rootUri: string, uri: string) => {
      const rootExpandedKeys = data.expandedKeysByRoot[rootUri] || [];
      const rootSelectedKeys = data.selectedKeysByRoot[rootUri] || [];
      const childrenUris = data.childKeyMap[uri] || [];
      const children = FileTreeNode.childrenFromArray(
        childrenUris.map(childUri => buildNode(rootUri, childUri)),
      );

      const isExpanded = rootExpandedKeys.indexOf(uri) >= 0;
      let isLoading = false;

      if (isExpanded && FileTreeHelpers.isDirKey(uri)) {
        this._fetchChildKeys(uri);
        isLoading = true;
      }

      return new FileTreeNode({
        uri,
        rootUri,
        isExpanded,
        isSelected: rootSelectedKeys.indexOf(uri) >= 0,
        isLoading,
        isTracked: false,
        children,
        isCwd: false,
        connectionTitle: FileTreeHelpers.getDisplayTitle(rootUri) || '',
      },
      this._conf);
    };

    if (data.openFilesExpanded != null) {
      this.openFilesExpanded = data.openFilesExpanded;
    }

    if (data.uncommittedChangesExpanded != null) {
      this.uncommittedChangesExpanded = data.uncommittedChangesExpanded;
    }

    const normalizedAtomPaths = atom.project.getPaths().map(nuclideUri.ensureTrailingSeparator);
    const normalizedDataPaths = data.rootKeys
      .map(nuclideUri.ensureTrailingSeparator)
      .filter(rootUri =>
        nuclideUri.isRemote(rootUri) || normalizedAtomPaths.indexOf(rootUri) >= 0,
      );
    const pathsMissingInData = normalizedAtomPaths.filter(rootUri =>
      normalizedDataPaths.indexOf(rootUri) === -1,
    );
    const combinedPaths = normalizedDataPaths.concat(pathsMissingInData);

    this._setRoots(new Immutable.OrderedMap(
      combinedPaths.map(rootUri => [rootUri, buildNode(rootUri, rootUri)]),
    ));
  }

  _setExcludeVcsIgnoredPaths(excludeVcsIgnoredPaths: boolean): void {
    this._updateConf(conf => { conf.excludeVcsIgnoredPaths = excludeVcsIgnoredPaths; });
  }

  _setHideIgnoredNames(hideIgnoredNames: boolean): void {
    this._updateConf(conf => { conf.hideIgnoredNames = hideIgnoredNames; });
  }

  _setIsCalculatingChanges(isCalculatingChanges: boolean): void {
    this._updateConf(conf => { conf.isCalculatingChanges = isCalculatingChanges; });
  }

  /**
   * Given a list of names to ignore, compile them into minimatch patterns and
   * update the store with them.
   */
  _setIgnoredNames(ignoredNames: Array<string>) {
    const ignoredPatterns = Immutable.Set(ignoredNames)
      .map(ignoredName => {
        if (ignoredName === '') {
          return null;
        }
        try {
          return new Minimatch(ignoredName, {matchBase: true, dot: true});
        } catch (error) {
          atom.notifications.addWarning(
            `Error parsing pattern '${ignoredName}' from "Settings" > "Ignored Names"`,
            {detail: error.message},
          );
          return null;
        }
      })
      .filter(pattern => pattern != null);
    this._updateConf(conf => { conf.ignoredPatterns = ignoredPatterns; });
  }

  _onDispatch(payload: FileTreeAction): void {
    switch (payload.actionType) {
      case ActionTypes.DELETE_SELECTED_NODES:
        this._deleteSelectedNodes();
        break;
      case ActionTypes.SET_CWD:
        this._setCwdKey(payload.rootKey);
        break;
      case ActionTypes.SET_TRACKED_NODE:
        this._setTrackedNode(payload.rootKey, payload.nodeKey);
        break;
      case ActionTypes.CLEAR_TRACKED_NODE:
        this._clearTrackedNode();
        break;
      case ActionTypes.MOVE_TO_NODE:
        this._moveToNode(payload.rootKey, payload.nodeKey);
        break;
      case ActionTypes.SET_ROOT_KEYS:
        this._setRootKeys(payload.rootKeys);
        break;
      case ActionTypes.EXPAND_NODE:
        this._expandNode(payload.rootKey, payload.nodeKey);
        break;
      case ActionTypes.EXPAND_NODE_DEEP:
        this._expandNodeDeep(payload.rootKey, payload.nodeKey);
        break;
      case ActionTypes.COLLAPSE_NODE:
        this._collapseNode(payload.rootKey, payload.nodeKey);
        break;
      case ActionTypes.SET_EXCLUDE_VCS_IGNORED_PATHS:
        this._setExcludeVcsIgnoredPaths(payload.excludeVcsIgnoredPaths);
        break;
      case ActionTypes.SET_USE_PREVIEW_TABS:
        this._setUsePreviewTabs(payload.usePreviewTabs);
        break;
      case ActionTypes.SET_USE_PREFIX_NAV:
        this._setUsePrefixNav(payload.usePrefixNav);
        break;
      case ActionTypes.COLLAPSE_NODE_DEEP:
        this._collapseNodeDeep(payload.rootKey, payload.nodeKey);
        break;
      case ActionTypes.SET_HIDE_IGNORED_NAMES:
        this._setHideIgnoredNames(payload.hideIgnoredNames);
        break;
      case ActionTypes.SET_IS_CALCULATING_CHANGES:
        this._setIsCalculatingChanges(payload.isCalculatingChanges);
        break;
      case ActionTypes.SET_IGNORED_NAMES:
        this._setIgnoredNames(payload.ignoredNames);
        break;
      case ActionTypes.SET_VCS_STATUSES:
        this._setVcsStatuses(payload.rootKey, payload.vcsStatuses);
        break;
      case ActionTypes.SET_REPOSITORIES:
        this._setRepositories(payload.repositories);
        break;
      case ActionTypes.SET_WORKING_SET:
        this._setWorkingSet(payload.workingSet);
        break;
      case ActionTypes.SET_OPEN_FILES_WORKING_SET:
        this._setOpenFilesWorkingSet(payload.openFilesWorkingSet);
        break;
      case ActionTypes.SET_WORKING_SETS_STORE:
        this._setWorkingSetsStore(payload.workingSetsStore);
        break;
      case ActionTypes.START_EDITING_WORKING_SET:
        this._startEditingWorkingSet(payload.editedWorkingSet);
        break;
      case ActionTypes.FINISH_EDITING_WORKING_SET:
        this._finishEditingWorkingSet();
        break;
      case ActionTypes.CHECK_NODE:
        this._checkNode(payload.rootKey, payload.nodeKey);
        break;
      case ActionTypes.UNCHECK_NODE:
        this._uncheckNode(payload.rootKey, payload.nodeKey);
        break;

      case ActionTypes.SET_DRAG_HOVERED_NODE:
        this._setDragHoveredNode(payload.rootKey, payload.nodeKey);
        break;
      case ActionTypes.UNHOVER_NODE:
        this._unhoverNode(payload.rootKey, payload.nodeKey);
        break;
      case ActionTypes.SET_SELECTED_NODE:
        this._setSelectedNode(payload.rootKey, payload.nodeKey);
        break;
      case ActionTypes.SET_FOCUSED_NODE:
        this._setFocusedNode(payload.rootKey, payload.nodeKey);
        break;
      case ActionTypes.ADD_SELECTED_NODE:
        this._addSelectedNode(payload.rootKey, payload.nodeKey);
        break;
      case ActionTypes.UNSELECT_NODE:
        this._unselectNode(payload.rootKey, payload.nodeKey);
        break;
      case ActionTypes.MOVE_SELECTION_UP:
        this._moveSelectionUp();
        break;
      case ActionTypes.RANGE_SELECT_TO_NODE:
        this._rangeSelectToNode(payload.rootKey, payload.nodeKey);
        break;
      case ActionTypes.RANGE_SELECT_UP:
        this._rangeSelectUp();
        break;
      case ActionTypes.RANGE_SELECT_DOWN:
        this._rangeSelectDown();
        break;
      case ActionTypes.MOVE_SELECTION_DOWN:
        this._moveSelectionDown();
        break;
      case ActionTypes.MOVE_SELECTION_TO_TOP:
        this._moveSelectionToTop();
        break;
      case ActionTypes.MOVE_SELECTION_TO_BOTTOM:
        this._moveSelectionToBottom();
        break;
      case ActionTypes.ENSURE_CHILD_NODE:
        this._ensureChildNode(payload.nodeKey);
        break;
      case ActionTypes.CLEAR_FILTER:
        this.clearFilter();
        break;
      case ActionTypes.ADD_EXTRA_PROJECT_SELECTION_CONTENT:
        this.addExtraProjectSelectionContent(payload.content);
        break;
      case ActionTypes.REMOVE_EXTRA_PROJECT_SELECTION_CONTENT:
        this.removeExtraProjectSelectionContent(payload.content);
        break;
      case ActionTypes.SET_OPEN_FILES_EXPANDED:
        this._setOpenFilesExpanded(payload.openFilesExpanded);
        break;
      case ActionTypes.SET_UNCOMMITTED_CHANGES_EXPANDED:
        this._setUncommittedChangesExpanded(payload.uncommittedChangesExpanded);
        break;
      case ActionTypes.INVALIDATE_REMOVED_FOLDER:
        this._invalidateRemovedFolder();
        break;
    }
  }

  /**
  * Use the predicate function to update one or more of the roots in the file tree
  */
  _updateRoots(predicate: (root: FileTreeNode) => FileTreeNode): void {
    this._setRoots(this.roots.map(predicate));
  }

  /**
  * Use the predicate to update a node (or a branch) of the file-tree
  */
  _updateNodeAtRoot(
    rootKey: NuclideUri,
    nodeKey: NuclideUri,
    predicate: (node: FileTreeNode) => FileTreeNode,
  ): void {
    const root = this.roots.get(rootKey);
    if (root == null) {
      return;
    }

    const node = root.find(nodeKey);
    if (node == null) {
      return;
    }

    const roots = this.roots.set(rootKey, this._bubbleUp(node, predicate(node)));

    this._setRoots(roots);
  }

  /**
   * Update a node by calling the predicate, returns the new node.
   */
  _updateNode(
    node: FileTreeNode,
    predicate: (node: FileTreeNode) => FileTreeNode,
  ): FileTreeNode {
    const newNode = predicate(node);
    const roots = this.roots.set(node.rootUri, this._bubbleUp(node, newNode));
    this._setRoots(roots);
    return newNode;
  }

  /**
  * Update a node or a branch under any of the roots it was found at
  */
  _updateNodeAtAllRoots(
    nodeKey: NuclideUri,
    predicate: (node: FileTreeNode
  ) => FileTreeNode): void {
    const roots = this.roots.map(root => {
      const node = root.find(nodeKey);
      if (node == null) {
        return root;
      }

      return this._bubbleUp(node, predicate(node));
    });

    this._setRoots(roots);
  }

  /**
  * Bubble the change up. The newNode is assumed to be prevNode after some manipulateion done to it
  * therefore they are assumed to belong to the same parent.
  *
  * The method updates the child to the new node (which create a new parent instance) and call
  * recursively for the parent update. Until there are no more parents and the new root is returned
  *
  * As the change bubbles up, and in addition to the change from the new child assignment, an
  * optional predicate is also being applied to each newly created parent to support more complex
  * change patterns.
  */
  _bubbleUp(
    prevNode: FileTreeNode,
    newNode: FileTreeNode,
    postPredicate: (node: FileTreeNode) => FileTreeNode = (node => node),
  ): FileTreeNode {
    const parent = prevNode.parent;
    if (parent == null) {
      return newNode;
    }

    const newParent = postPredicate(parent.updateChild(newNode));
    return this._bubbleUp(parent, newParent, postPredicate);
  }

  /**
  * Updates the roots, maintains their sibling relationships and fires the change event.
  */
  _setRoots(roots: Immutable.OrderedMap<NuclideUri, FileTreeNode>): void {
    // Explicitly test for the empty case, otherwise configuration changes with an empty
    // tree will not emit changes.
    const changed = !Immutable.is(roots, this.roots) || roots.isEmpty();
    if (changed) {
      this.roots = roots;
      let prevRoot = null;
      roots.forEach(r => {
        r.prevSibling = prevRoot;
        if (prevRoot != null) {
          prevRoot.nextSibling = r;
        }
        prevRoot = r;
      });

      if (prevRoot != null) {
        prevRoot.nextSibling = null;
      }

      this._emitChange();
    }
  }

  _emitChange(): void {
    if (this._suppressChanges) {
      return;
    }

    if (this._animationFrameRequestSubscription != null) {
      this._animationFrameRequestSubscription.unsubscribe();
    }

    this._animationFrameRequestSubscription = nextAnimationFrame.subscribe(() => {
      const {performance} = global;
      const renderStart = performance.now();
      const childrenCount = this.roots.reduce((sum, root) => sum + root.shownChildrenBelow, 0);

      this._emitter.emit('change');
      this._suppressChanges = true;
      this._checkTrackedNode();
      this._suppressChanges = false;
      this._animationFrameRequestSubscription = null;

      const duration = (performance.now() - renderStart).toString();
      track('filetree-root-node-component-render', {
        'filetree-root-node-component-render-duration': duration,
        'filetree-root-node-component-rendered-child-count': childrenCount,
      });
    });
  }

  /**
  * Update the configuration for the file-tree. The direct writing to the this._conf should be
  * avoided.
  */
  _updateConf(predicate: (conf: StoreConfigData) => void): void {
    predicate(this._conf);
    this._updateRoots(root => {
      return root.updateConf().setRecursive(
        // Remove selection from hidden nodes under this root
        node => (node.containsSelection && node.containsHidden ? null : node),
        node => {
          if (node.shouldBeShown) {
            return node;
          }

          // The node is hidden - unselect all nodes under it if there are any
          return node.setRecursive(
            subNode => (subNode.containsSelection ? null : subNode),
            subNode => subNode.setIsSelected(false),
          );
        },
      );
    });
  }

  getTrackedNode(): ?FileTreeNode {
    // Locate the root containing the tracked node efficiently by using the child-derived
    // containsTrackedNode property
    const trackedRoot = this.roots.find(root => root.containsTrackedNode);
    if (trackedRoot == null) {
      return null;
    }

    let trackedNode;
    // Likewise, within the root use the property to efficiently find the needed node
    trackedRoot.traverse(
      node => {
        if (node.isTracked) {
          trackedNode = node;
        }

        return trackedNode == null && node.containsTrackedNode;
      },
    );

    return trackedNode;
  }

  getRepositories(): Immutable.Set<atom$Repository> {
    return this._repositories;
  }

  getWorkingSet(): WorkingSet {
    return this._conf.workingSet;
  }

  getWorkingSetsStore(): ?WorkingSetsStore {
    return this._workingSetsStore;
  }

  getRootKeys(): Array<NuclideUri> {
    return this.roots.toArray().map(root => root.uri);
  }

  /**
   * Returns true if the store has no data, i.e. no roots, no children.
   */
  isEmpty(): boolean {
    return this.roots.isEmpty();
  }

  getFileChanges(): Immutable.Map<NuclideUri, Map<NuclideUri, FileChangeStatusValue>> {
    return this._fileChanges;
  }

  getIsCalculatingChanges(): boolean {
    return this._conf.isCalculatingChanges;
  }

  _invalidateRemovedFolder(): void {
    const updatedFileChanges = new Map();
    atom.project.getPaths().forEach(projectPath => {
      const standardizedPath = nuclideUri.ensureTrailingSeparator(projectPath);
      // Atom sometimes tells you a repo exists briefly even after it has been removed
      // This causes the map to first flush out the repo and then again try to add the
      // repo but the files now don't exist causing an undefined value to be added.
      // Adding check to prevent this from happening.
      const fileChangesForPath = this._fileChanges.get(standardizedPath);
      if (fileChangesForPath != null) {
        updatedFileChanges.set(standardizedPath, fileChangesForPath);
      }
    });

    this._fileChanges = new Immutable.Map(updatedFileChanges);
  }

  _setFileChanges(
    rootKey: NuclideUri,
    vcsStatuses: {[path: NuclideUri]: StatusCodeNumberValue},
  ): void {
    const fileChanges = new Map();
    Object.keys(vcsStatuses).forEach(filePath => {
      const statusCode = vcsStatuses[filePath];
      fileChanges.set(filePath, HgStatusToFileChangeStatus[statusCode]);
    });

    this._fileChanges = this._fileChanges.set(rootKey, fileChanges);
  }

  _setVcsStatuses(
    rootKey: NuclideUri,
    vcsStatuses: {[path: NuclideUri]: StatusCodeNumberValue},
  ): void {
    // We use file changes for populating the uncommitted list, this is different as compared
    // to what is computed in the vcsStatuses in that it does not need the exact path but just
    // the root folder present in atom and the file name and its status. Another difference is
    // in the terms used for status change, while uncommitted changes needs the HgStatusChange
    // codes the file tree doesn't.
    this._setFileChanges(rootKey, vcsStatuses);

    // We can't build on the child-derived properties to maintain vcs statuses in the entire
    // tree, since the reported VCS status may be for a node that is not yet present in the
    // fetched tree, and so it it can't affect its parents statuses. To have the roots colored
    // consistently we manually add all parents of all of the modified nodes up till the root
    const enrichedVcsStatuses = {...vcsStatuses};

    const ensurePresentParents = uri => {
      if (uri === rootKey) {
        return;
      }

      let current = uri;
      while (current !== rootKey) {
        current = FileTreeHelpers.getParentKey(current);

        if (enrichedVcsStatuses[current] != null) {
          return;
        }

        enrichedVcsStatuses[current] = StatusCodeNumber.MODIFIED;
      }
    };

    Object.keys(vcsStatuses).forEach(uri => {
      const status = vcsStatuses[uri];
      if (
        status === StatusCodeNumber.MODIFIED ||
        status === StatusCodeNumber.ADDED ||
        status === StatusCodeNumber.REMOVED) {
        try { // An invalid URI might cause an exception to be thrown
          ensurePresentParents(uri);
        } catch (e) {
          this._logger.error(`Error enriching the VCS statuses for ${uri}`, e);
        }
      }
    });

    if (this._vcsStatusesAreDifferent(rootKey, enrichedVcsStatuses)) {
      this._updateConf(conf => {
        conf.vcsStatuses = conf.vcsStatuses.set(rootKey, enrichedVcsStatuses);
      });
    }
  }

  _vcsStatusesAreDifferent(
    rootKey: NuclideUri,
    newVcsStatuses: {[path: NuclideUri]: StatusCodeNumberValue},
  ): boolean {
    const currentStatuses = this._conf.vcsStatuses.get(rootKey);
    if (currentStatuses == null || newVcsStatuses == null) {
      if (currentStatuses !== newVcsStatuses) {
        return true;
      }
    }

    const currentKeys = Object.keys(currentStatuses);
    const newKeys = Object.keys(newVcsStatuses);
    if (currentKeys.length !== newKeys.length) {
      return true;
    }

    return newKeys.some(key => currentStatuses[key] !== newVcsStatuses[key]);
  }

  _setUsePreviewTabs(usePreviewTabs: boolean): void {
    this._updateConf(conf => { conf.usePreviewTabs = usePreviewTabs; });
  }

  _setUsePrefixNav(usePrefixNav: boolean) {
    this._usePrefixNav = usePrefixNav;
  }

  usePrefixNav(): boolean {
    return this._usePrefixNav;
  }

  /**
   * The node child keys may either be available immediately (cached), or
   * require an async fetch. If all of the children are needed it's easier to
   * return as promise, to make the caller oblivious to the way children were
   * fetched.
   */
  async promiseNodeChildKeys(rootKey: string, nodeKey: string): Promise<Array<NuclideUri>> {
    const shownChildrenUris = node => {
      return node.children.toArray().filter(n => n.shouldBeShown).map(n => n.uri);
    };

    const node = this.getNode(rootKey, nodeKey);
    if (node == null) {
      return [];
    }

    if (!node.isLoading) {
      return shownChildrenUris(node);
    }

    await this._fetchChildKeys(nodeKey);
    return this.promiseNodeChildKeys(rootKey, nodeKey);
  }

  /**
  * Uses the .containsSelection child-derived property to efficiently build the list of the
  * currently selected nodes
  */
  getSelectedNodes(): Immutable.List<FileTreeNode> {
    const selectedNodes = [];
    this.roots.forEach(root => {
      root.traverse(
        node => {
          if (node.isSelected) {
            selectedNodes.push(node);
          }
          return node.containsSelection;
        },
      );
    });
    return new Immutable.List(selectedNodes);
  }

  /**
  * Returns a node if it is the only one selected, or null otherwise
  */
  getSingleSelectedNode(): ?FileTreeNode {
    const selectedNodes = this.getSelectedNodes();

    if (selectedNodes.isEmpty() || selectedNodes.size > 1) {
      return null;
    }

    return selectedNodes.first();
  }

  getNode(rootKey: NuclideUri, nodeKey: NuclideUri): ?FileTreeNode {
    const rootNode = this.roots.get(rootKey);

    if (rootNode == null) {
      return null;
    }

    return rootNode.find(nodeKey);
  }

  getRootForPath(nodeKey: NuclideUri): ?FileTreeNode {
    const rootNode = this.roots.find(root => nodeKey.startsWith(root.uri));
    return rootNode || null;
  }

  isEditingWorkingSet(): boolean {
    return this._conf.isEditingWorkingSet;
  }

  /**
  * Builds the edited working set from the partially-child-derived .checkedStatus property
  */
  getEditedWorkingSet(): WorkingSet {
    return this._conf.editedWorkingSet;
  }

  isEditedWorkingSetEmpty(): boolean {
    return this.roots.every(root => root.checkedStatus === 'clear');
  }

  getOpenFilesWorkingSet(): WorkingSet {
    return this._conf.openFilesWorkingSet;
  }

  /**
   * Initiates the fetching of node's children if it's not already in the process.
   * Clears the node's .isLoading property once the fetch is complete.
   * Once the fetch is completed, clears the node's .isLoading property, builds the map of the
   * node's children out of the fetched children URIs and a change subscription is created
   * for the node to monitor future changes.
   */
  _fetchChildKeys(nodeKey: NuclideUri): Promise<void> {
    const existingPromise = this._getLoading(nodeKey);
    if (existingPromise != null) {
      return existingPromise;
    }

    const promise = FileTreeHelpers.fetchChildren(nodeKey)
      .then(
        childrenKeys => this._setFetchedKeys(nodeKey, childrenKeys),
        error => {
          this._logger.error(`Unable to fetch children for "${nodeKey}".`);
          this._logger.error('Original error: ', error);

          // Unless the contents were already fetched in the past
          // collapse the node and clear its loading state on error so the
          // user can retry expanding it.
          this._updateNodeAtAllRoots(nodeKey, node => {
            if (node.wasFetched) {
              return node.setIsLoading(false);
            }

            return node.set(
              {isExpanded: false, isLoading: false, children: new Immutable.OrderedMap()},
            );
          });

          this._clearLoading(nodeKey);
        },
      );

    this._setLoading(nodeKey, promise);
    return promise;
  }

  _setFetchedKeys(nodeKey: NuclideUri, childrenKeys: Array<string> = []): void {
    const directory = FileTreeHelpers.getDirectoryByKey(nodeKey);

    // The node with URI === nodeKey might be present at several roots - update them all
    this._updateNodeAtAllRoots(nodeKey, node => {
      // Maintain the order fetched from the FS
      const childrenNodes = childrenKeys.map(uri => {
        const prevNode = node.find(uri);
        // If we already had a child with this URI - keep it
        if (prevNode != null) {
          return prevNode;
        }

        return new FileTreeNode({
          uri,
          rootUri: node.rootUri,
          isCwd: uri === this._cwdKey,
        }, this._conf);
      });

      const children = FileTreeNode.childrenFromArray(childrenNodes);
      const subscription = node.subscription || this._makeSubscription(nodeKey, directory);

      // If the fetch indicated that some children were removed - dispose of all
      // their subscriptions
      const removedChildren = node.children.filter(n => !children.has(n.name));
      removedChildren.forEach(c => {
        c.traverse(n => {
          if (n.subscription != null) {
            n.subscription.dispose();
          }

          return true;
        });
      });

      return node.set({isLoading: false, wasFetched: true, children, subscription});
    });

    this._clearLoading(nodeKey);
  }

  _makeSubscription(nodeKey: NuclideUri, directory: ?Directory): ?IDisposable {
    if (directory == null) {
      return null;
    }

    let fetchingPromise = null;
    let couldMissUpdate = false;

    try {
      // Here we intentionally circumvent, to a degree, the logic in the _fetchChildKeys
      // which wouldn't schedule a new fetch if there is already one running.
      // This is fine for the most cases, but not for the subscription handling, as the
      // subscription is notifying us that something has changed and if a fetch is already in
      // progress then it is racing with the change. Therefore, if we detect that there was a change
      // during the fetch we schedule another right after the first has finished.
      const checkMissed = () => {
        fetchingPromise = null;
        if (couldMissUpdate) {
          fetchKeys();
        }
      };

      const fetchKeys = () => {
        if (fetchingPromise == null) {
          couldMissUpdate = false;
          fetchingPromise = this._fetchChildKeys(nodeKey).then(checkMissed);
        } else {
          couldMissUpdate = true;
        }
      };

      // This call might fail if we try to watch a non-existing directory, or if permission denied.
      return directory.onDidChange(() => {
        fetchKeys();
      });
    } catch (ex) {
      /*
       * Log error and mark the directory as dirty so the failed subscription will be attempted
       * again next time the directory is expanded.
       */
      this._logger.error(`Cannot subscribe to directory "${nodeKey}"`, ex);
      return null;
    }
  }

  _getLoading(nodeKey: NuclideUri): ?Promise<void> {
    return this._isLoadingMap.get(nodeKey);
  }

  _setLoading(nodeKey: NuclideUri, value: Promise<void>): void {
    this._isLoadingMap = this._isLoadingMap.set(nodeKey, value);
  }

  hasCwd(): boolean {
    return this._cwdKey != null;
  }

  _setCwdKey(cwdKey: ?NuclideUri): void {
    if (this._cwdKey != null) {
      this._updateNodeAtAllRoots(this._cwdKey, node => node.setIsCwd(false));
    }
    this._cwdKey = cwdKey;
    if (cwdKey != null) {
      this._updateNodeAtAllRoots(cwdKey, node => node.setIsCwd(true));
    }
  }

  getFilter(): string {
    return this._filter;
  }

  addFilterLetter(letter: string): void {
    this._filter = this._filter + letter;
    this._updateRoots(root => {
      return root.setRecursive(
        node => (node.containsFilterMatches ? null : node),
        node => {
          return matchesFilter(node.name, this._filter) ? node.set({
            highlightedText: this._filter,
            matchesFilter: true,
          }) : node.set({highlightedText: '', matchesFilter: false});
        },
      );
    });
    this._selectFirstFilter();
    this._emitChange();
  }

  clearFilter(): void {
    this._filter = '';
    this._updateRoots(root => {
      return root.setRecursive(
        node => null,
        node => node.set({highlightedText: '', matchesFilter: true}),
      );
    });
  }

  removeFilterLetter(): void {
    const oldLength = this._filter.length;
    this._filter = this._filter.substr(0, this._filter.length - 1);
    if (oldLength > 1) {
      this._updateRoots(root => {
        return root.setRecursive(
          node => null,
          node => {
            return matchesFilter(node.name, this._filter) ? node.set({
              highlightedText: this._filter,
              matchesFilter: true,
            }) : node.set({highlightedText: '', matchesFilter: false});
          },
        );
      });
      this._emitChange();
    } else if (oldLength === 1) {
      this.clearFilter();
    }
  }

  getExtraProjectSelectionContent(): Immutable.List<React.Element<any>> {
    return this._extraProjectSelectionContent;
  }

  addExtraProjectSelectionContent(content: React.Element<any>) {
    this._extraProjectSelectionContent = this._extraProjectSelectionContent.push(content);
    this._emitChange();
  }

  removeExtraProjectSelectionContent(content: React.Element<any>) {
    const index = this._extraProjectSelectionContent.indexOf(content);
    if (index === -1) {
      return;
    }
    this._extraProjectSelectionContent = this._extraProjectSelectionContent.remove(index);
    this._emitChange();
  }

  getFilterFound(): boolean {
    return this.roots.some(root => root.containsFilterMatches);
  }

  /**
   * Resets the node to be kept in view if no more data is being awaited. Safe to call many times
   * because it only changes state if a node is being tracked.
   */
  _checkTrackedNode(): void {
    if (
      /*
       * The loading map being empty is a heuristic for when loading has completed. It is inexact
       * because the loading might be unrelated to the tracked node, however it is cheap and false
       * positives will only last until loading is complete or until the user clicks another node in
       * the tree.
       */
      this._isLoadingMap.isEmpty()
    ) {
      // Loading has completed. Allow scrolling to proceed as usual.
      this._clearTrackedNode();
    }
  }

  _clearLoading(nodeKey: NuclideUri): void {
    this._isLoadingMap = this._isLoadingMap.delete(nodeKey);
  }

  async _moveToNode(rootKey: NuclideUri, nodeKey: NuclideUri): Promise<void> {
    const targetNode = this.getNode(rootKey, nodeKey);
    if (targetNode == null || !targetNode.isContainer) {
      return;
    }

    const selectedNodes = this.getSelectedNodes();
    this._clearDragHover();
    this._clearSelection();

    try {
      await FileTreeHgHelpers.moveNodes(selectedNodes.toJS(), targetNode.uri);
    } catch (e) {
      atom.notifications.addError('Failed to move entries: ' + e.message);
    }
  }

  async _deleteSelectedNodes(): Promise<void> {
    const selectedNodes = this.getSelectedNodes();
    try {
      await FileTreeHgHelpers.deleteNodes(selectedNodes.toJS());
      this._selectionRange = null;
    } catch (e) {
      atom.notifications.addError('Failed to delete entries: ' + e.message);
    }
  }

  _expandNode(rootKey: NuclideUri, nodeKey: NuclideUri): void {
    this._updateNodeAtRoot(rootKey, nodeKey, node => {
      return node.setIsExpanded(true).setRecursive(
        n => (!n.isContainer || !n.isExpanded ? n : null),
        n => {
          if (n.isContainer && n.isExpanded) {
            this._fetchChildKeys(n.uri);
            return n.setIsLoading(true);
          }

          return n;
        },
      );
    });
  }

  /**
   * Performes a deep BFS scanning expand of contained nodes.
   * returns - a promise fulfilled when the expand operation is finished
   */
  _expandNodeDeep(rootKey: NuclideUri, nodeKey: NuclideUri): Promise<void> {
    // Stop the traversal after 100 nodes were added to the tree
    const itNodes = new FileTreeStoreBfsIterator(this, rootKey, nodeKey, /* limit */ 100);
    const promise = new Promise(resolve => {
      const expand = () => {
        const traversedNodeKey = itNodes.traversedNode();
        if (traversedNodeKey) {
          this._expandNode(rootKey, traversedNodeKey);

          const nextPromise = itNodes.next();
          if (nextPromise) {
            nextPromise.then(expand);
          }
        } else {
          resolve();
        }
      };

      expand();
    });

    return promise;
  }

  _collapseNode(rootKey: NuclideUri, nodeKey: NuclideUri): void {
    this._updateNodeAtRoot(rootKey, nodeKey, node => {
      // Clear all selected nodes under the node being collapsed and dispose their subscriptions
      return node.setRecursive(
        childNode => {
          if (childNode.isExpanded) {
            return null;
          }
          return childNode;
        },
        childNode => {
          if (childNode.subscription != null) {
            childNode.subscription.dispose();
          }

          if (childNode.uri === node.uri) {
            return childNode.set({isExpanded: false, subscription: null});
          } else {
            return childNode.set({isSelected: false, subscription: null});
          }
        },
      );
    });
  }

  _collapseNodeDeep(rootKey: NuclideUri, nodeKey: NuclideUri): void {
    this._updateNodeAtRoot(rootKey, nodeKey, node => {
      return node.setRecursive(
        /* prePredicate */ null,
        childNode => {
          if (childNode.subscription != null) {
            childNode.subscription.dispose();
          }

          if (childNode.uri !== node.uri) {
            return childNode.set({isExpanded: false, isSelected: false, subscription: null});
          } else {
            return childNode.set({isExpanded: false, subscription: null});
          }
        },
      );
    });
  }

  _setDragHoveredNode(rootKey: NuclideUri, nodeKey: NuclideUri): void {
    this._clearDragHover();
    this._updateNodeAtRoot(rootKey, nodeKey, node => node.setIsDragHovered(true));
  }

  _unhoverNode(rootKey: NuclideUri, nodeKey: NuclideUri): void {
    this._updateNodeAtRoot(rootKey, nodeKey, node => node.setIsDragHovered(false));
  }

  /**
  * Selects a single node and tracks it.
  */
  _setSelectedNode(rootKey: NuclideUri, nodeKey: NuclideUri): void {
    this._clearSelection(rootKey, nodeKey);
    this._updateNodeAtRoot(rootKey, nodeKey, node => node.setIsSelected(true));
    this._setTrackedNode(rootKey, nodeKey);
    this._selectionRange = SelectionRange.ofSingleItem(new RangeKey(rootKey, nodeKey));
  }

  /**
   * Mark a node that has been focused, similar to selected, but only true after mouseup.
   */
  _setFocusedNode(rootKey: NuclideUri, nodeKey: NuclideUri): void {
    this._updateNodeAtRoot(rootKey, nodeKey, node => node.setIsFocused(true));
  }

  /**
   * Selects and focuses a node in one pass.
   */
  _setSelectedAndFocusedNode(rootKey: NuclideUri, nodeKey: NuclideUri): void {
    this._clearSelection(rootKey, nodeKey);
    this._updateNodeAtRoot(rootKey, nodeKey, node =>
      node.set({isSelected: true, isFocused: true}),
    );
    this._setTrackedNode(rootKey, nodeKey);
    this._selectionRange = SelectionRange.ofSingleItem(new RangeKey(rootKey, nodeKey));
  }

  _addSelectedNode(rootKey: NuclideUri, nodeKey: NuclideUri): void {
    this._updateNodeAtRoot(rootKey, nodeKey, node => node.setIsSelected(true));
    this._selectionRange = SelectionRange.ofSingleItem(new RangeKey(rootKey, nodeKey));
  }

  _unselectNode(rootKey: NuclideUri, nodeKey: NuclideUri): void {
    this._updateNodeAtRoot(rootKey, nodeKey, node =>
      node.set({isSelected: false, isFocused: false}),
    );
  }

  _setSelectionRange(selectionRange: SelectionRange): void {
    this._selectionRange = selectionRange;
  }

  _clearSelectionRange(): void {
    this._selectionRange = null;
  }

  /**
   * Refresh the selection range data.
   * invalidate the data
   * - if anchor node or range node is deleted.
   * - if these two nodes are not selected, and there is no nearby node to fall back to.
   * When this function returns, the selection range always contains valid data.
   */
  _refreshSelectionRange(): ?{
    selectionRange: SelectionRange,
    anchorNode: FileTreeNode,
    rangeNode: FileTreeNode,
    anchorIndex: number,
    rangeIndex: number,
    direction: 'up' | 'down' | 'none'} {
    const invalidate = () => {
      this._selectionRange = null;
      return null;
    };

    let selectionRange = this._selectionRange;
    if (selectionRange == null) {
      return invalidate();
    }
    const anchor = selectionRange.anchor();
    const range = selectionRange.range();
    let anchorNode = this.getNode(anchor.rootKey(), anchor.nodeKey());
    let rangeNode = this.getNode(range.rootKey(), range.nodeKey());
    if (anchorNode == null || rangeNode == null) {
      return invalidate();
    }

    anchorNode = RangeUtil.findSelectedNode(anchorNode);
    rangeNode = RangeUtil.findSelectedNode(rangeNode);
    if (anchorNode == null || rangeNode == null) {
      return invalidate();
    }
    const anchorIndex = anchorNode.calculateVisualIndex();
    const rangeIndex = rangeNode.calculateVisualIndex();
    const direction =
      rangeIndex > anchorIndex ? 'down' : (rangeIndex === anchorIndex ? 'none' : 'up');

    selectionRange = new SelectionRange(RangeKey.of(anchorNode), RangeKey.of(rangeNode));
    this._setSelectionRange(selectionRange);
    return {selectionRange, anchorNode, rangeNode, anchorIndex, rangeIndex, direction};
  }

  /**
   * Bulk selection based on the range.
   */
  _rangeSelectToNode(rootKey: NuclideUri, nodeKey: NuclideUri): void {
    const data = this._refreshSelectionRange();
    if (data == null) {
      return;
    }
    const {selectionRange, anchorIndex, rangeIndex} = data;

    let nextRangeNode = this.getNode(rootKey, nodeKey);
    if (nextRangeNode == null) {
      return;
    }
    const nextRangeIndex = nextRangeNode.calculateVisualIndex();
    if (nextRangeIndex === rangeIndex) {
      return;
    }

    const modMinIndex = Math.min(anchorIndex, rangeIndex, nextRangeIndex);
    const modMaxIndex = Math.max(anchorIndex, rangeIndex, nextRangeIndex);

    let beginIndex = 1;

    // traversing the tree, flip the isSelected flag when applicable.
    const roots = this.roots.map(
      (rootNode: FileTreeNode): FileTreeNode => rootNode.setRecursive(
        // keep traversing the sub-tree,
        // - if the node is shown, has children, and in the applicable range.
        (node: FileTreeNode): ?FileTreeNode => {
          if (!node.shouldBeShown) {
            return node;
          }
          if (node.shownChildrenBelow === 1) {
            beginIndex++;
            return node;
          }
          const endIndex = beginIndex + node.shownChildrenBelow - 1;
          if (beginIndex <= modMaxIndex && modMinIndex <= endIndex) {
            beginIndex++;
            return null;
          }
          beginIndex += node.shownChildrenBelow;
          return node;
        },
        // flip the isSelected flag accordingly, based on previous and current range.
        (node: FileTreeNode): FileTreeNode => {
          if (!node.shouldBeShown) {
            return node;
          }
          const curIndex = beginIndex - node.shownChildrenBelow;
          const inOldRange = Math.sign(curIndex - anchorIndex)
                           * Math.sign(curIndex - rangeIndex) !== 1;
          const inNewRange = Math.sign(curIndex - anchorIndex)
                           * Math.sign(curIndex - nextRangeIndex) !== 1;
          if (inOldRange && inNewRange || !inOldRange && !inNewRange) {
            return node;
          } else if (inOldRange && !inNewRange) {
            return node.set({isSelected: false, isFocused: false});
          } else {
            return node.set({isSelected: true, isFocused: true});
          }
        },
      ),
    );
    this._setRoots(roots);

    // expand the range to merge existing selected nodes.
    const getNextNode =
      (cur: FileTreeNode) => (nextRangeIndex < rangeIndex ? cur.findPrevious() : cur.findNext());
    let probe = getNextNode(nextRangeNode);
    while (probe != null && probe.isSelected) {
      nextRangeNode = probe;
      probe = getNextNode(nextRangeNode);
    }
    this._setSelectionRange(selectionRange.withNewRange(RangeKey.of(nextRangeNode)));
  }

  /**
   * Move the range of selections by one step.
   */
  _rangeSelectMove(move: 'up' | 'down'): void {
    const data = this._refreshSelectionRange();
    if (data == null) {
      return;
    }
    const {selectionRange, anchorNode, rangeNode, direction} = data;
    const getNextNode =
      (cur: FileTreeNode) => (move === 'up' ? cur.findPrevious() : cur.findNext());

    const isExpanding = direction === move || direction === 'none';

    if (isExpanding) {
      let nextNode = getNextNode(rangeNode);
      while (nextNode != null && nextNode.isSelected) {
        nextNode = getNextNode(nextNode);
      }
      if (nextNode == null) {
        return;
      }
      nextNode = this._updateNode(nextNode, n => n.set({isSelected: true, isFocused: true}));
      let probe = getNextNode(nextNode);
      while (probe != null && probe.isSelected) {
        nextNode = probe;
        probe = getNextNode(nextNode);
      }
      this._selectionRange = selectionRange.withNewRange(RangeKey.of(nextNode));
      this._setTrackedNode(nextNode.rootUri, nextNode.uri);
    } else {
      let nextNode = rangeNode;
      while (nextNode != null && nextNode !== anchorNode && nextNode.isSelected === false) {
        nextNode = getNextNode(nextNode);
      }
      if (nextNode == null) {
        return;
      }
      if (nextNode === anchorNode) {
        this._selectionRange = selectionRange.withNewRange(RangeKey.of(nextNode));
        return;
      }
      nextNode = this._updateNode(nextNode, n => n.set({isSelected: false, isFocused: false}));
      this._selectionRange = selectionRange.withNewRange(RangeKey.of(nextNode));
      this._setTrackedNode(nextNode.rootUri, nextNode.uri);
    }
  }

  _rangeSelectUp(): void {
    this._rangeSelectMove('up');
  }

  _rangeSelectDown(): void {
    this._rangeSelectMove('down');
  }

  _selectFirstFilter(): void {
    let node = this.getSingleSelectedNode();
    // if the current node matches the filter do nothing
    if (node != null && node.matchesFilter) {
      return;
    }

    this._moveSelectionDown();
    node = this.getSingleSelectedNode();
    // if the selection does not find anything up go down
    if (node != null && !node.matchesFilter) {
      this._moveSelectionUp();
    }
  }

  /**
  * Moves the selection one node down. In case several nodes were selected, the topmost (first in
  * the natural visual order) is considered to be the reference point for the move.
  */
  _moveSelectionDown(): void {
    if (this.roots.isEmpty()) {
      return;
    }

    const selectedNodes = this.getSelectedNodes();

    let nodeToSelect;
    if (selectedNodes.isEmpty()) {
      nodeToSelect = this.roots.first();
    } else {
      const selectedNode = selectedNodes.first();
      nodeToSelect = selectedNode.findNext();
    }

    while (nodeToSelect != null && !nodeToSelect.matchesFilter) {
      nodeToSelect = nodeToSelect.findNext();
    }

    if (nodeToSelect != null) {
      this._setSelectedAndFocusedNode(nodeToSelect.rootUri, nodeToSelect.uri);
    }
  }

  /**
  * Moves the selection one node up. In case several nodes were selected, the topmost (first in
  * the natural visual order) is considered to be the reference point for the move.
  */
  _moveSelectionUp(): void {
    if (this.roots.isEmpty()) {
      return;
    }

    const selectedNodes = this.getSelectedNodes();

    let nodeToSelect;
    if (selectedNodes.isEmpty()) {
      nodeToSelect = this.roots.last().findLastRecursiveChild();
    } else {
      const selectedNode = selectedNodes.first();
      nodeToSelect = selectedNode.findPrevious();
    }

    while (nodeToSelect != null && !nodeToSelect.matchesFilter) {
      nodeToSelect = nodeToSelect.findPrevious();
    }

    if (nodeToSelect != null) {
      this._setSelectedAndFocusedNode(nodeToSelect.rootUri, nodeToSelect.uri);
    }
  }

  _moveSelectionToTop(): void {
    if (this.roots.isEmpty()) {
      return;
    }

    let nodeToSelect = this.roots.first();
    if (nodeToSelect != null && !nodeToSelect.shouldBeShown) {
      nodeToSelect = nodeToSelect.findNext();
    }

    if (nodeToSelect != null) {
      this._setSelectedAndFocusedNode(nodeToSelect.uri, nodeToSelect.uri);
    }
  }

  _moveSelectionToBottom(): void {
    if (this.roots.isEmpty()) {
      return;
    }

    const lastRoot = this.roots.last();
    const lastChild = lastRoot.findLastRecursiveChild();
    this._setSelectedAndFocusedNode(lastChild.rootUri, lastChild.uri);
  }

  _clearDragHover(): void {
    this._updateRoots(root => {
      return root.setRecursive(
        node => (node.containsDragHover ? null : node),
        node => node.setIsDragHovered(false),
      );
    });
  }

  // Clear selections and focuses on all nodes except an optionally specified
  // current node.
  _clearSelection(currRootKey?: NuclideUri, currNodeKey?: NuclideUri): void {
    this._updateRoots(root => {
      return root.setRecursive(
        node => (node.containsSelection ? null : node),
        node => {
          return (node.rootUri === currRootKey && node.uri === currNodeKey) ?
            node : node.set({isSelected: false, isFocused: false});
        },
      );
    });
    this._selectionRange = null;
  }

  _setRootKeys(rootKeys: Array<NuclideUri>): void {
    const rootNodes = rootKeys.map(rootUri => {
      const root = this.roots.get(rootUri);
      if (root != null) {
        return root;
      }

      return new FileTreeNode({
        uri: rootUri,
        rootUri,
        connectionTitle: FileTreeHelpers.getDisplayTitle(rootUri) || '',
      }, this._conf);
    });

    const roots = new Immutable.OrderedMap(rootNodes.map(root => [root.uri, root]));
    const removedRoots = this.roots.filter(root => !roots.has(root.uri));
    removedRoots.forEach(root => root.traverse(
      node => node.isExpanded,
      node => {
        if (node.subscription != null) {
          node.subscription.dispose();
        }
      },
    ));
    this._setRoots(roots);

    // Just in case there's a race between the update of the root keys and the cwdKey and the cwdKey
    // is set too early - set it again. If there was no race - it's a noop.
    this._setCwdKey(this._cwdKey);
  }

  /**
  * Makes sure a certain child node is present in the file tree, creating all its ancestors, if
  * needed and scheduling a chilld key fetch. Used by the reveal active file functionality.
  */
  _ensureChildNode(nodeKey: NuclideUri): void {
    let firstRootUri;

    const expandNode = node => {
      if (node.isExpanded && node.subscription != null) {
        return node;
      }

      if (node.subscription != null) {
        node.subscription.dispose();
      }

      const directory = FileTreeHelpers.getDirectoryByKey(node.uri);
      const subscription = this._makeSubscription(node.uri, directory);
      return node.set({subscription, isExpanded: true});
    };

    this._updateRoots(root => {
      if (!nodeKey.startsWith(root.uri)) {
        return root;
      }

      if (firstRootUri == null) {
        firstRootUri = root.uri;
      }

      const deepest = root.findDeepest(nodeKey);
      if (deepest == null) {
        return root;
      }

      if (deepest.uri === nodeKey) {
        return this._bubbleUp(
          deepest,
          deepest,
          expandNode,
        );
      }

      const parents = [];
      let currentParentUri = FileTreeHelpers.getParentKey(nodeKey);
      const rootUri = root.uri;
      while (currentParentUri !== deepest.uri) {
        parents.push(currentParentUri);
        currentParentUri = FileTreeHelpers.getParentKey(currentParentUri);
      }

      let currentChild = new FileTreeNode({uri: nodeKey, rootUri}, this._conf);

      parents.forEach(currentUri => {
        this._fetchChildKeys(currentUri);
        const parent = new FileTreeNode(
          {
            uri: currentUri,
            rootUri,
            isLoading: true,
            isExpanded: true,
            children: FileTreeNode.childrenFromArray([currentChild]),
          },
          this._conf,
        );

        currentChild = parent;
      });

      this._fetchChildKeys(deepest.uri);
      return this._bubbleUp(
        deepest,
        deepest.set({
          isLoading: true,
          isExpanded: true,
          children: deepest.children.set(currentChild.name, currentChild),
        }),
        expandNode,
      );
    });

    if (firstRootUri != null) {
      this._setSelectedNode(firstRootUri, nodeKey);
    }
  }

  _clearTrackedNode(): void {
    this._updateRoots(root => {
      if (!root.containsTrackedNode) {
        return root;
      }

      return root.setRecursive(
        node => (node.containsTrackedNode ? null : node),
        node => node.setIsTracked(false),
      );
    });
  }

  _setTrackedNode(rootKey: NuclideUri, nodeKey: NuclideUri): void {
    this._clearTrackedNode();
    this._updateNodeAtRoot(rootKey, nodeKey, node => node.setIsTracked(true));
  }

  _setRepositories(repositories: Immutable.Set<atom$Repository>): void {
    this._repositories = repositories;
    this._updateConf(conf => {
      const reposByRoot = {};
      this.roots.forEach(root => {
        reposByRoot[root.uri] = repositoryForPath(root.uri);
      });
      conf.reposByRoot = reposByRoot;
    });
  }

  _setWorkingSet(workingSet: WorkingSet): void {
    this._updateConf(conf => { conf.workingSet = workingSet; });
  }

  _setOpenFilesWorkingSet(openFilesWorkingSet: WorkingSet): void {
    this._updateConf(conf => { conf.openFilesWorkingSet = openFilesWorkingSet; });
  }

  _setWorkingSetsStore(workingSetsStore: ?WorkingSetsStore): void {
    this._workingSetsStore = workingSetsStore;
  }

  _startEditingWorkingSet(editedWorkingSet: WorkingSet): void {
    this._updateConf(conf => {
      conf.editedWorkingSet = editedWorkingSet;
      conf.isEditingWorkingSet = true;
    });
  }

  _finishEditingWorkingSet(): void {
    this._updateConf(conf => {
      conf.isEditingWorkingSet = false;
      conf.editedWorkingSet = new WorkingSet();
    });
  }

  _checkNode(rootKey: NuclideUri, nodeKey: NuclideUri): void {
    if (!this._conf.isEditingWorkingSet) {
      return;
    }

    let node = this.getNode(rootKey, nodeKey);
    if (node == null) {
      return;
    }

    let uriToAppend = nodeKey; // Workaround flow's (over)aggressive nullability detection

    const allChecked = nodeParent => {
      return nodeParent.children.every(c => {
        return !c.shouldBeShown || c.checkedStatus === 'checked' || c === node;
      });
    };

    while (node.parent != null && allChecked(node.parent)) {
      node = node.parent;
      uriToAppend = node.uri;
    }

    this._updateConf(conf => {
      conf.editedWorkingSet = conf.editedWorkingSet.append(uriToAppend);
    });
  }

  _uncheckNode(rootKey: NuclideUri, nodeKey: NuclideUri): void {
    if (!this._conf.isEditingWorkingSet) {
      return;
    }

    let node = this.getNode(rootKey, nodeKey);
    if (node == null) {
      return;
    }

    const nodesToAppend = [];
    let uriToRemove = nodeKey;

    while (node.parent != null && node.parent.checkedStatus === 'checked') {
      const parent = node.parent; // Workaround flow's (over)aggressive nullability detection
      parent.children.forEach(c => {
        if (c !== node) {
          nodesToAppend.push(c);
        }
      });

      node = parent;
      uriToRemove = node.uri;
    }

    this._updateConf(conf => {
      const urisToAppend = nodesToAppend.map(n => n.uri);
      conf.editedWorkingSet = conf.editedWorkingSet.remove(uriToRemove).append(...urisToAppend);
    });
  }

  _setOpenFilesExpanded(openFilesExpanded: boolean): void {
    this.openFilesExpanded = openFilesExpanded;
    this._emitChange();
  }

  _setUncommittedChangesExpanded(uncommittedChangesExpanded: boolean): void {
    this.uncommittedChangesExpanded = uncommittedChangesExpanded;
    this._emitChange();
  }

  reset(): void {
    this.roots.forEach(root => {
      root.traverse(n => {
        if (n.subscription != null) {
          n.subscription.dispose();
        }

        return true;
      });
    });

    // Reset data store.
    this._conf = DEFAULT_CONF;
    this._setRoots(new Immutable.OrderedMap());
  }

  subscribe(listener: ChangeListener): IDisposable {
    return this._emitter.on('change', listener);
  }
}

/**
 * Performs a breadth-first iteration over the directories of the tree starting
 * with a given node. The iteration stops once a given limit of nodes (both directories
 * and files) were traversed.
 * The node being currently traversed can be obtained by calling .traversedNode()
 * .next() returns a promise that is fulfilled when the traversal moves on to
 * the next directory.
 */
class FileTreeStoreBfsIterator {
  _fileTreeStore: FileTreeStore;
  _rootKey: NuclideUri;
  _nodesToTraverse: Array<NuclideUri>;
  _currentlyTraversedNode: ?NuclideUri;
  _limit: number;
  _numNodesTraversed: number;
  _promise: ?Promise<void>;
  _count: number;

  constructor(
      fileTreeStore: FileTreeStore,
      rootKey: NuclideUri,
      nodeKey: NuclideUri,
      limit: number) {
    this._fileTreeStore = fileTreeStore;
    this._rootKey = rootKey;
    this._nodesToTraverse = [];
    this._currentlyTraversedNode = nodeKey;
    this._limit = limit;
    this._numNodesTraversed = 0;
    this._promise = null;
    this._count = 0;
  }

  _handlePromiseResolution(childrenKeys: Array<NuclideUri>): void {
    this._numNodesTraversed += childrenKeys.length;
    if (this._numNodesTraversed < this._limit) {
      const nextLevelNodes = childrenKeys.filter(childKey => FileTreeHelpers.isDirKey(childKey));
      this._nodesToTraverse = this._nodesToTraverse.concat(nextLevelNodes);

      this._currentlyTraversedNode = this._nodesToTraverse.splice(0, 1)[0];
      this._promise = null;
    } else {
      this._currentlyTraversedNode = null;
      this._promise = null;
    }

    return;
  }

  next(): ?Promise<void> {
    const currentlyTraversedNode = this._currentlyTraversedNode;
    if (!this._promise && currentlyTraversedNode) {
      this._promise = this._fileTreeStore.promiseNodeChildKeys(
        this._rootKey,
        currentlyTraversedNode)
      .then(this._handlePromiseResolution.bind(this));
    }
    return this._promise;
  }

  traversedNode(): ?string {
    return this._currentlyTraversedNode;
  }
}
