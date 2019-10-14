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

	private _undoStack: CursorState[];
	private _prevState: CursorState | null;

	constructor(initialState: CursorState | null) {
		this._undoStack = [];
		this._prevState = initialState;
	}

	public onStateUpdate(newState: CursorState | null): void {
		if (this._prevState) {
			this._undoStack.push(this._prevState);
			if (this._undoStack.length > CursorStateStack.STACK_SIZE_LIMIT) {
				// keep the cursor undo stack bounded
				this._undoStack.shift();
			}
		}

		this._prevState = newState;
	}

	public undo(): CursorState | null {
		// don't change anything if there is nothing in the undo stack
		if (this._undoStack.length === 0) {
			return null;
		}

		// pop the latest state from the undo stack and return it
		const prevState = this._undoStack.pop()!;
		this._prevState = prevState;
		return prevState;
	}

	public redo(): CursorState | null {
		// TODO: implement
		return null;
	}

	public reset(): void {
		this._undoStack = [];
		this._prevState = null;
	}
}

export class CursorUndoController extends Disposable implements IEditorContribution {

	private static readonly ID = 'editor.contrib.cursorUndoController';

	public static get(editor: ICodeEditor): CursorUndoController {
		return editor.getContribution<CursorUndoController>(CursorUndoController.ID);
	}

	private readonly _editor: ICodeEditor;
	private _isChangingState: boolean;
	private _cursorStateStack: CursorStateStack;

	constructor(editor: ICodeEditor) {
		super();
		this._editor = editor;
		this._isChangingState = false;

		this._cursorStateStack = new CursorStateStack(this._readState());

		this._register(editor.onDidChangeModel((e) => {
			// TODO: check if editor has a model now and disable undo/redo if not
			this._cursorStateStack.reset();
		}));
		this._register(editor.onDidChangeModelContent((e) => {
			this._cursorStateStack.reset();
		}));
		this._register(editor.onDidChangeCursorSelection((e) => {
			// don't push the state again if we were the ones who changed the state
			if (!this._isChangingState) {
				const newState = this._readState();
				this._cursorStateStack.onStateUpdate(newState);
			}
		}));
	}

	public getId(): string {
		return CursorUndoController.ID;
	}

	private _readState(): CursorState | null {
		if (!this._editor.hasModel()) {
			// no model => no state
			return null;
		}

		return new CursorState(this._editor.getSelections());
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
