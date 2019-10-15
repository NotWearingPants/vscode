/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { Disposable } from 'vs/base/common/lifecycle';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction, ServicesAccessor, registerEditorAction, registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { Selection } from 'vs/editor/common/core/selection';
import { IEditorContribution, ScrollType } from 'vs/editor/common/editorCommon';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { equals } from 'vs/base/common/arrays';

class CursorState {
	readonly selections: readonly Selection[];

	constructor(selections: readonly Selection[]) {
		this.selections = selections;
	}

	public equals(other: CursorState): boolean {
		return equals(this.selections, other.selections, (a, b) => a.equalsSelection(b));
	}
}

class CursorStateStack {
	private static readonly STACK_SIZE_LIMIT = 50;

	private _cursorStateHistory: CursorState[];
	private _positionInHistory: number;

	constructor(initialState: CursorState) {
		this.reset(initialState);
	}

	public reset(currentState: CursorState): void {
		// initialize the history with the current state only
		this._cursorStateHistory = [currentState];
		this._positionInHistory = 0;
	}

	public onStateUpdate(newState: CursorState): void {
		// delete all the history items that are in the future
		this._cursorStateHistory.splice(this._positionInHistory + 1);

		// add the new state and advance the position
		this._cursorStateHistory.push(newState);
		this._positionInHistory++;

		// keep the cursor undo stack bounded
		if (this._cursorStateHistory.length > CursorStateStack.STACK_SIZE_LIMIT) {
			this._cursorStateHistory.shift();
			this._positionInHistory--;
		}
	}

	private _getCurrentState(): CursorState {
		// the top-most item in the history is the current state
		return this._cursorStateHistory[this._positionInHistory]!;
	}

	public undo(): CursorState | null {
		// don't change anything if there are no states from the past
		if (this._positionInHistory === 0) {
			return null;
		}

		// move the position in history back
		this._positionInHistory--;

		// return the new current state
		const newState = this._getCurrentState();
		return newState;
	}

	public redo(): CursorState | null {
		// don't change anything if there are no states from the future
		if (this._positionInHistory === this._cursorStateHistory.length - 1) {
			return null;
		}

		// move the position in history forward
		this._positionInHistory++;

		// return the new current state
		const newState = this._getCurrentState();
		return newState;
	}
}

export class CursorUndoController extends Disposable implements IEditorContribution {

	private static readonly ID = 'editor.contrib.cursorUndoController';

	public static get(editor: ICodeEditor): CursorUndoController {
		return editor.getContribution<CursorUndoController>(CursorUndoController.ID);
	}

	private readonly _editor: ICodeEditor;
	private _isChangingState: boolean;
	private readonly _cursorStateStack: CursorStateStack;

	constructor(editor: ICodeEditor) {
		super();
		this._editor = editor;
		this._isChangingState = false;

		// initialize the cursor state stack with the current state
		this._cursorStateStack = new CursorStateStack(this._readState());

		// reset stack on model changes
		this._register(editor.onDidChangeModel((e) => {
			const newState = this._readState();
			this._cursorStateStack.reset(newState);
		}));

		// reset stack on content changes
		this._register(editor.onDidChangeModelContent((e) => {
			const newState = this._readState();
			this._cursorStateStack.reset(newState);
		}));

		// update stack on cursor changes
		this._register(editor.onDidChangeCursorSelection((e) => {
			// don't update the state if we we're the ones who changed the state
			if (!this._isChangingState) {
				const newState = this._readState();
				this._cursorStateStack.onStateUpdate(newState);
			}
		}));
	}

	public getId(): string {
		return CursorUndoController.ID;
	}

	private _readState(): CursorState {
		return new CursorState(this._editor.getSelections() || []);
	}

	private _updateCursorState(newState: CursorState | null): void {
		// null means the state should not change
		if (newState === null) {
			return;
		}

		// change the selections in the editor to match the new state
		this._isChangingState = true;
		this._editor.setSelections(newState.selections);
		this._isChangingState = false;

		// reveal the new primary selection if necessary
		this._editor.revealRangeInCenterIfOutsideViewport(newState.selections[0], ScrollType.Smooth);
	}

	public cursorUndo(): void {
		this._updateCursorState(this._cursorStateStack.undo());
	}

	public cursorRedo(): void {
		this._updateCursorState(this._cursorStateStack.redo());
	}
}

export class CursorUndo extends EditorAction {
	constructor() {
		super({
			id: 'cursorUndo',
			label: nls.localize('cursor.undo', 'Soft Undo'),
			alias: 'Soft Undo',
			precondition: undefined,
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: KeyMod.CtrlCmd | KeyCode.KEY_U,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor, args: any): void {
		CursorUndoController.get(editor).cursorUndo();
	}
}

export class CursorRedo extends EditorAction {
	constructor() {
		super({
			id: 'cursorRedo',
			label: nls.localize('cursor.redo', 'Soft Redo'),
			alias: 'Soft Redo',
			precondition: undefined,
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_J,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor, args: any): void {
		CursorUndoController.get(editor).cursorRedo();
	}
}

registerEditorContribution(CursorUndoController);
registerEditorAction(CursorUndo);
registerEditorAction(CursorRedo);
