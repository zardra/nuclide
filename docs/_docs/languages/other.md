---
pageid: language-other
title: PHP, JS, OCaml
layout: docs
permalink: /docs/languages/other/
---

Nuclide provides support for other languages as well. Some of these are not as full-featured as
similar languages (e.g., Hack vs PHP); others are experimental.

* TOC
{:toc}

## PHP

Nuclide's PHP support is similar to its support for [Hack](/docs/languages/hack), except you will
not get as full-featured diagnostics, type hinting, etc. since there is no
[typechecker](https://docs.hhvm.com/hack/typechecker/introduction) to assist Nuclide with your project's metadata.

## JavaScript

Nuclide's JavaScript support is similar to its support for [Flow](/docs/languages/flow), except
you will not get as full-featured diagnostics, type hinting, etc. since there is no
[typechecker](http://flowtype.org/) to assist Nuclide with your project's metadata.
[Debugging through Node](/docs/features/debugger/#basics) is similar to
[Flow](/docs/languages/flow/#debugging) as well.

JavaScript is a primary language for [React Native](https://facebook.github.io/react-native/), and
Nuclide is a great IDE for [developing React Native applications](/docs/platforms/react-native).

## OCaml

This **experimental** feature provides rudimentary support for OCaml via
[ocamlmerlin](https://github.com/the-lambda-church/merlin). Merlin can be installed from source
or by installing the `merlin` OPAM package.

OCaml's integration into Nuclide provides you with productivity features such as:

* [Autocomplete](#ocaml__auto-complete)
* [Jump to Definition](#ocaml__jump-to-definition)
* [Type Hinting](#ocaml__type-hinting)
* [Code Diagnostics](#ocaml__code-diagnostics)

It requires that `ocamlmerlin` be installed on your system and properly configured for your
project. `ocamlmerlin` should be in your `$PATH` environment variable. If it is not, you may specify the path to
`ocamlmerlin` in the settings for the 'nuclide' package.

1. Open the [Nuclide Settings](/docs/editor/basics/#preferences-pane) tab either by pressing `Cmd+,` (`Ctrl-,` on Linux) or by going to `Package | Settings View | Open`.
2. Select **Packages** from the list at the left, and search for `nuclide`.
3. Click on the **Settings** button for the `nuclide` package.
4. Scroll down until you find `nuclide-ocaml`, and enter the custom path in the **Path to Merlin Executable** text box.

### Autocomplete

Given that Nuclide has access to all of the type information within your project along with the
built-in types provided by OCaml, autocomplete just works.

<!-- INSERT SCREENSHOT HERE -->

### Jump to Definition

Nuclide provides a jump to definition/symbol feature for OCaml programs.

<!-- INSERT SCREENSHOT HERE -->

### Type Hinting

If you hover over a variable in your OCaml file, you can get the type of the variable directly inline.

<!-- INSERT SCREENSHOT HERE -->

In fact, you can even pin that type hint so that it always displays. Just click on the pin icon when hovering over a variable to pin it.

<!-- INSERT SCREENSHOT HERE -->

The highlighted variables show that their type variables have been pinned. If you hover over the
type hint, its associated variable will have motion in its highlight.

Click the `x` icon of a pinned type hint to remove it.

> Pinned type hints can be moved anywhere within the editor.

### Code Diagnostics

If you write code that doesn't pass the OCaml typechecker, Nuclide will provide you error details in
both its [Code Diagnostics](/docs/editor/basics/#status-bar__code-diagnostics) pane and inline
within the [Editing Area](/docs/editor/basics/#editing-area).

<!-- INSERT SCREENSHOT HERE -->

Hover over the sideways red triangle in the [gutter](/docs/editor/basics/#gutter) to see the OCaml
error inline.

<!-- INSERT SCREENSHOT HERE -->
