# Code Formatting Implementation Plan

This document outlines the implementation of Biome formatter for the amqplib project, introducing consistent code formatting with automated pre-commit hooks.

## Implementation Steps

### Phase 1: Foundation Setup
1. **Update Node.js engine requirement** - Bump to v16 minimum (preparation for future test harness modernisation)
2. **Install Biome formatter** - Add @biomejs/biome as development dependency
3. **Configure Biome settings** - Create biome.json with project formatting standards:
   - Indent: 2 spaces
   - Line width: 140 characters  
   - Brackets: no spacing
   - Quotes: single
   - Trailing commas: all
   - Semicolons: always
   - Parentheses: always around arrow function parameters

### Phase 2: Initial Formatting (lib/ directory)
4. **Generate lib/defs.js** - Run make target to ensure generated code is properly formatted
5. **Format lib/ directory** - Apply Biome formatting to all source code in lib/ only
6. **Validate changes** - Execute complete test suite to verify formatting maintains functionality
7. **Add format script** - Create npm script for formatting lib/ directory

### Phase 3: Automation Setup
8. **Install Lefthook** - Add Lefthook as development dependency for git hooks
9. **Configure pre-commit hook** - Set up automatic formatting of staged files before commit

### Phase 4: Project-wide Formatting
10. **Expand formatting scope** - Update configuration to format all project files
11. **Format entire codebase** - Apply Biome formatting to all JavaScript files
12. **Final validation** - Execute complete test suite to verify all changes maintain functionality
13. **Update changelog** - Add entry for v1.0.0 summarising the formatting implementation
14. **Commit changes** - Create commit for project-wide formatting implementation

## Pull Request Structure
<!-- Stackable PR organization will be defined here -->
