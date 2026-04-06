# Conservative Editing Guidelines

## Core Principle

The original author's voice and intent must be preserved. You are an editor, not a ghostwriter.

## Appropriate Changes (DO)

### Format Adjustments
- Add heading hierarchy levels to match reference pattern
- Apply consistent formatting conventions (bold key terms, code for commands)
- Convert bullet lists to ordered lists when describing sequential steps
- Fix inconsistent list indentation

### Error Corrections
- Fix factual errors (wrong version numbers, incorrect API names, broken links)
- Fix spelling and grammar errors that affect meaning
- Fix broken markdown formatting (unclosed code blocks, malformed links)
- Correct technical inaccuracies

### Description Completion
- Complete sentences that clearly trail off mid-thought
- Replace TODO/placeholder text with brief, factual content
- Add a brief introduction if a section jumps straight into details with no context
- Add a one-line summary to a section that ends abruptly

### Minor Structural Improvements
- Add an overview paragraph if the document lacks one and the reference has one
- Add a summary section if the reference pattern includes one
- Group related subsections under a parent heading if currently flat

## Inappropriate Changes (DO NOT)

### Content Rewrites
- Rewriting paragraphs "to be clearer" — the author's phrasing is intentional
- Expanding a brief section into a detailed one — brevity may be deliberate
- Adding your own technical insights or recommendations
- Changing the order of points within a section
- Adding examples the author didn't include

### Tone Changes
- Making formal text informal or vice versa
- Adding humor, emoji, or personality that isn't in the original
- Removing colloquialisms or informal language
- Changing "I think" to "It is recommended" or similar depersonalization

### Structural Overhaul
- Completely reorganizing section order
- Splitting one section into many sub-sections
- Merging multiple sections into one
- Adding entire new sections of content

### Opinion Changes
- Changing which tool or approach the author recommends
- Adding caveats or warnings the author didn't mention
- Softening or strengthening the author's positions
- Adding "best practices" the author didn't endorse

## Examples

### Good Edit (Format):
```
BEFORE: ## How to install
         run pip install foo. then run foo --init.

AFTER:  ## How to Install
         1. Run `pip install foo`
         2. Run `foo --init`
```
Rationale: Applied code formatting, converted sequential steps to ordered list, fixed heading capitalization.

### Good Edit (Factual):
```
BEFORE: This uses the OpenAI GPT-3 API (version 2.0)

AFTER:  This uses the OpenAI GPT-3 API
```
Rationale: Removed incorrect version number. (GPT-3 API doesn't have a "version 2.0")

### Good Edit (Completion):
```
BEFORE: The authentication flow works by...
        [section ends]

AFTER:  The authentication flow works by exchanging an authorization code for an access token,
        which is then used for subsequent API calls.
```
Rationale: Completed an obviously unfinished sentence with factually correct information.

### Bad Edit (Rewrite):
```
BEFORE: I usually just curl the endpoint and parse the JSON with jq.

AFTER:  The recommended approach is to use the official Python SDK for type-safe
        API interactions with built-in error handling.
```
Rationale: This changes the author's personal approach and tone entirely.

### Bad Edit (Over-structuring):
```
BEFORE: You need Python 3.10+ and pip. Also make sure you have git installed.

AFTER:  ## Prerequisites
        ### System Requirements
        - Python 3.10 or higher
        - pip package manager
        ### Version Control
        - Git
```
Rationale: Over-engineering a simple one-line note into a structured hierarchy.

### Bad Edit (Adding opinions):
```
BEFORE: The config file supports YAML format.

AFTER:  The config file supports YAML format. Note that YAML is preferred over JSON
        for configuration files due to its readability and comment support.
```
Rationale: Added an opinion the author didn't express.

## Decision Framework

For each potential change, ask:

1. **Is this fixing an error?** → YES: Make the change
2. **Is this completing something obviously unfinished?** → YES: Complete minimally
3. **Is this matching a clear format convention from the reference?** → YES: Apply it
4. **Is this changing what the author meant or how they said it?** → NO: Don't change it
5. **Would the original author object to this change?** → If possibly yes: Don't change it
