---
pageid: feature-task-runner
title: Task Runner
layout: docs
permalink: /docs/features/task-runner/
---

Nuclide provides a Task Runner toolbar for building, running, and debugging [Buck](/docs/features/buck), [Swift](/docs/languages/swift), and [Hack/HHVM](/docs/languages/hack) projects.

* TOC
{:toc}

## Buck

## Swift

### Building a Swift package

1. Click the **Toggle Task Runner Toolbar** button on the [Nuclide toolbar](/docs/features/toolbar/#buttons) (or use the [Command Palette](/docs/editor/basics/#command-palette) to issue the **Nuclide Task Runner: Toggle Swift Toolbar** command) to display options for building a Swift package.<br /><br />
![](/static/images/docs/feature-task-runner-swift-build-toolbar.png)

2. Select **Build** from the Swift Task drop-down menu.
3. Enter the path to a Swift package's root directory, then click the **Build** button to build the package. (This path is entered automatically if your project root is set to
a Swift package root.) Build output is displayed in the [Console](/docs/features/debugger/#basics__evaluation) below the [Editing Area](/docs/editor/basics/#editing-area).

![](/static/images/docs/feature-task-runner-swift-build-output.png)

You can customize build settings, such as whether to build the package in a "Debug" or "Release" configuration, by clicking the gear icon to the right
of the Swift Task toolbar.

![](/static/images/docs/feature-task-runner-swift-build-settings.png)

### Running a Swift package's tests

1. Select **Test** from the Swift Task drop-down menu to display options for running a Swift package's tests.<br /><br />
![](/static/images/docs/feature-task-runner-swift-test-toolbar.png)

2. Enter the path to a Swift package's root directory, then click the **Test** button to run the package's tests. (This path is entered automatically if your project root is set
to a Swift package root.) Test output is displayed in the [Console](/docs/features/debugger/#basics__evaluation) below the [Editing Area](/docs/editor/basics/#editing-area).

![](/static/images/docs/feature-task-runner-swift-test-output.png)

Clicking the gear icon to the right of the Swift Task toolbar displays additional settings for running your Swift package's tests.

## HHVM Debug Toolbar

Nuclide provides an HHVM toolbar in the Task Runner. You can launch the toolbar by clicking the **Toggle Task Runner Toolbar** button in the [Nuclide toolbar](/docs/features/toolbar/#buttons) or from the [Command Palette](/docs/editor/basics/#command-palette) with `Nuclide Task Runner: Toggle HHVM Toolbar`.

![](/static/images/docs/feature-task-runner-hack-toolbar.png)

> You must have a Hack or PHP file open to successfully launch the toolbar.

You can choose either **Attach to WebServer** or **Launch Script** from the drop-down menu.  If you select **Attach to WebServer**, the text box will fill automatically with the server to which you are connected.  If you select **Launch Script**, the text box will fill automatically with the path of the open file.

<img src="/static/images/docs/feature-task-runner-hack-selection.png" align="middle" style="width: 500px;"/>

Set [breakpoints](/docs/features/debugger/#basics__breakpoints) in your code.

Click the **Debug** button to open the Debugger; it will stop at the first breakpoint.

You can then follow the [basic Debugger information](/docs/features/debugger/#basics) and use the additional features of the [Console](/docs/languages/hack/#debugging__console), [Evaluation](/docs/languages/hack/#debugging__evaluation), [Filtering](/docs/languages/hack/#debugging__filtering) and [other HHVM-specific debugging settings]( /docs/languages/hack/#debugging__other-settings) to debug your code.

![](/static/images/docs/feature-task-runner-hack-debugging.png)

In both the script and server launching/attaching scenarios, the line at which you've set a
breakpoint will highlight in blue when the breakpoint is hit. When this happens, execution of your
code is paused and you can use the Debugger Controls to step, evaluate expressions, inspect the current
call stack, etc.
