---
pageid: feature-debugger
title: Debugger
layout: docs
permalink: /docs/features/debugger/
---

One of the key features of Nuclide is its multiple-language debugging support provided with a debugger interface inspired by the familiar [Chrome DevTools](https://developer.chrome.com/devtools). The Nuclide Debugger provides many capabilities allowing you to have a productive debug loop,
including inspection, watches, setting breakpoints, step in/over/out, etc.

* TOC
{:toc}

## Instantiation

In general, the Debugger is instantiated via `Cmd-Shift-A` (`Ctrl-Shift-A` on Linux). You can also
toggle the Debugger through the [Command Palette](/docs/editor/basics/#command-palette) and the
[Nuclide toolbar](/docs/features/toolbar/#buttons)'s **Toggle Debugger** icon.

## Basics

Nuclide supports debugging for multiple [languages](#language-specific-debugging) and
[platforms](#platform-specific-debugging). However, there are some basic debugging concepts that apply across all languages. Debugging a Node
project will be used to help illustrate the points described here.

### Debuggable Target

Specific details are provided for each [language](#language-specific-debugging) or
[platform](#platform-specific-debugging), but in general, to begin debugging code in Nuclide, you
need to either launch a debug process from within Nuclide (e.g., iOS from the Buck toolbar) or
attach to a currently running process (e.g., `node`) for debugging.

*Example*

If you have a Node project running (e.g, via `npm start` or `node yourfile.js`), press
`Cmd-Shift-A` (`Ctrl-Shift-A` on Linux) to toggle the Debugger; this opens the Debugger Selection window. Then, attach Nuclide to the
relevant `node` process.

![](/static/images/docs/feature-debugger-basics-attach-target-process.png)

> If you have multiple processes running with the same name, you can use something similar to
> `ps aux | grep <process-name>` or Apple's Activity Monitor to find the Process ID (PID) that
> matches with the process in the list in Nuclide's Debugger Selection window.

Once you attach to a process, you will see a confirmation of the attachment in the command-line for
that process.

```bash
$ node read.js
Starting debugger agent.
Debugger listening on port 5858
```

After attaching to the process by clicking **Attach**, you should see the Debugger Controls to the right of the [Editing Area](/docs/editor/basics/#editing-area).

![](/static/images/docs/feature-debugger-basics-after-attaching.png)

### Breakpoints

To set a breakpoint in Nuclide, you use the [gutter](/docs/editor/basics#gutter). Click to the left
of each line number in the file(s) in which you want Nuclide to break the running program. Then
as the program in running, if a line on which a breakpoint is set is hit, the program halts, and you
are able to perform debugging tasks such as [step](#basics__stepping) and
[evaluation](#basics__evaluation) from that point.

> There is currently only one type of breakpoint called a *source breakpoint*. This is a breakpoint
> on one line of code. We are looking into ways to support functional, conditional, and other types
> of breakpoints.

*Example*

Here we have breakpoints on lines 13 and 18 of `read.js`.

![](/static/images/docs/feature-debugger-basics-breakpoints-set.png)

In the [main debugging](#basics__debugger) tab of the Debugger, you will see what
breakpoints are set as well.

![](/static/images/docs/feature-debugger-basics-breakpoints-debugger-controls.png)

### Debugger

The Debugger Controls are the information control center for the Nuclide Debugger.

In addition to the specialized areas described below, it also provides mouse-clickable execution,
[stepping](#basics__stepping), and breakpoint options.

***Call Stack***

The **Call Stack** area shows you where you came from to get to your current point in the code. The
top function is where you currently are, the function below the top is the one that called the
current function, and so on. Clicking on any function in the call stack will change the scope
information so that it is relevant to that function.

***Breakpoints***

The **Breakpoints** area shows you all the places in your project where you have breakpoints set. If
any are highlighted, that means that you have now hit that breakpoint while running the code. Clicking on a breakpoint in this list will move your cursor to its line of code in the Editing Area.  You can deactivate/reactive breakpoints using the green checkmarks next to each one.  Right-clicking in the area will give you the option to quickly remove all breakpoints at once.

<img src="/static/images/docs/feature-debugger-basics-breakpoint-menu.png" align="middle" style="width: 250px" />

***Unresolved Breakpoints***

These are breakpoints that cannot be resolved by the debugger. The most likely cause of an
unresolved breakpoint is putting a breakpoint on code that is not part of the project on which the
debugger process is attached.

***Locals***

The **Locals** area shows you information about local variables based upon the current point in the running of the code.

***Watch Expressions***

The **Watch Expressions** area is for you to keep track of the values of global and local variables. To add a new value to track, enter it in the `add new watch expression` text box. To remove a watched variable, click the `x` icon of the variable you wish to delete.

*Example*

Here we have breakpoints set on line 10 of `read.js` and line 3 of `math.js`. We set watches on two global variables (`num1` and `num2`) in the `read.js` file. The call stack shows that we are
currently in the `processSum` method and started from the `onData` method.

![](/static/images/docs/feature-debugger-basics-debugger-ex.png)

***Detaching***

![](/static/images/docs/feature-debugger-basics-detach.png)

You can detach the debugger from the current process by clicking the white "X" with the red background in the upper-right corner.
This will stop the entire debugging session for that process.

***Web Inspector***

![](/static/images/docs/feature-debugger-basics-webinspector.png)

You can open the Web Inspector by clicking on the Web Inspector icon (i.e., gear symbol). This will bring up
a [Chrome Developer Tools window](https://developers.google.com/web/tools/chrome-devtools/) for the
current debugging frame.

***Debugger UI Toggle***

![](/static/images/docs/feature-debugger-basics-ui-toggle.png)

The Debugger UI Toggle allows you to switch between the new Debugger Controls and the old Debugger UI.

![](/static/images/docs/feature-debugger-basics-main-debugging-tab.png)

### Stepping

It is essential for any debugger to have a mechanism to step into, over, and out of code. The
Nuclide Debugger provides stepping functionality with shortcuts within the Debugger itself and
via the [keyboard](/docs/editor/keyboard-shortcuts/#debugger).

<img src="/static/images/docs/feature-debugger-basics-stepping-controls.png" align="middle" style="width: 400px" />

*Example*

Assume we have a breakpoint set at line 22 of `read.js` (before the call to `processSum()`).

![](/static/images/docs/feature-debugger-basics-stepping-line22.png)

The following shows what happens when you step into the function. The code execution steps into the actual
`processSum()` function itself.

![](/static/images/docs/feature-debugger-basics-stepping-stepin-ex.png)

The following shows what happens when you step over the function. `processSum()` is fully executed,
and we move on to closing the `readline` object.

![](/static/images/docs/feature-debugger-basics-stepping-stepover-ex.png)

You can even step into a function that exists in another module.

![](/static/images/docs/feature-debugger-basics-stepping-other-module-ex.png)

### Evaluation

The Nuclide Debugger supports
[REPL](https://en.wikipedia.org/wiki/Read%E2%80%93eval%E2%80%93print_loop) via the **Console** tab.

When you hit a breakpoint during your debugging session, you can use the Console to write
expressions, call functions, etc. using the current state of the program at the breakpoint.

> For Hack and PHP debugging, hitting a breakpoint is not necessary to use the REPL support of
> the Nuclide Debugger. If you do not hit a breakpoint, then REPL is run in the global context as
> opposed to the current stack frame if a breakpoint is hit.

> For LLDB-based debugging, REPL runs LLDB debugger commands as opposed to evaluating code in the
> Debugger.

*Example*

Here we have a breakpoint before printing out the sum of the two global variables `num1` and `num2`.
This shows printing out the values of the global and local variables, writing simple expressions,
calling a function in another module (`math.add()`), and inspecting objects.

![](/static/images/docs/feature-debugger-basics-evaluation-ex.png)

## Language Specific Debugging

While the [general process](#basics) for debugging in Nuclide is similar, there are platform and
language specific debugging workflows that require discussion and illustration.

- [Hack and PHP](/docs/languages/hack/#debugging)
- [Flow and JavaScript](/docs/languages/flow/#debugging) (The canonical example for debugging as
  described [above](#basics)).
- [C++](/docs/languages/cpp/#debugging)
- [Objective-C](/docs/languages/objective-c/#debugging)


## Platform Specific Debugging

- [React Native](/docs/platforms/react-native/#debugging)
- [iOS](/docs/platforms/ios/#debugging)
- [Android](/docs/platforms/android/#debugging)

Buck projects can be more easily debugged via the [Buck toolbar](/docs/features/buck#debug).
