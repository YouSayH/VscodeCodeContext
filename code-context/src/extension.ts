import * as vscode from 'vscode';
import * as path from 'path';
import { CodeContextProvider } from './tree-provider';

export function activate(context: vscode.ExtensionContext) {
    console.log('🚀 Code Context Extension is now active!');

    // 1. ワークスペースのルートパスを取得
    const workspaceRoot = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
        ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;

    if (!workspaceRoot) {
        vscode.window.showInformationMessage('No workspace detected.');
        return;
    }

    // 2. Wasmフォルダのパスを特定 (拡張機能のインストール場所からの相対パス)
    // dist/extension.js から見て ../wasm にあるはず
    const wasmDir = path.join(context.extensionPath, 'wasm');

    // 3. TreeProvider の初期化
    const codeContextProvider = new CodeContextProvider(workspaceRoot, wasmDir);

    // 4. VS Code にツリービューを登録 (package.json の viewId と一致させる)
    vscode.window.registerTreeDataProvider('code-context-view', codeContextProvider);

    // 5. 更新コマンドの登録
    let disposable = vscode.commands.registerCommand('code-context.refresh', () => {
        codeContextProvider.refresh();
        vscode.window.showInformationMessage('Code Context refreshed!');
    });

    context.subscriptions.push(disposable);

    // 6. 初回インデックス作成を実行
    // (拡張機能起動時に自動で解析を始めます)
    codeContextProvider.initialize().then(() => {
        console.log("✅ Initial indexing complete.");
    });
}

export function deactivate() {}