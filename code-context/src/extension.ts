import * as vscode from 'vscode';
import * as path from 'path';
import { CodeGraph } from './code-graph';
import { CodeContextProvider } from './tree-provider';
import { CodeGraphPanel } from './panels/CodeGraphPanel';


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
    // CodeGraph をここで生成・管理する
    const codeGraph = new CodeGraph(wasmDir);

    // Provider にインスタンスを渡す (第2引数が wasmDir から codeGraph に変わります)
    const codeContextProvider = new CodeContextProvider(workspaceRoot, codeGraph);

    // 4. VS Code にツリービューを登録 (package.json の viewId と一致させる)
    vscode.window.registerTreeDataProvider('code-context-view', codeContextProvider);

    // 5. コマンド登録: グラフ画面を開く
    context.subscriptions.push(
        vscode.commands.registerCommand('code-context.openGraph', () => {
            CodeGraphPanel.createOrShow(context.extensionUri, codeGraph);
        })
    );

    // 6. コマンド登録: データ更新
    context.subscriptions.push(
        vscode.commands.registerCommand('code-context.refresh', () => {
        codeContextProvider.refresh();
        vscode.window.showInformationMessage('Code Context refreshed!');
        })
    );

    // 7. 初期化フロー: DB初期化 -> 初回スキャン
    codeGraph.init().then(async () => {
        // DB準備完了後にツリービュー用のスキャンを実行
        await codeContextProvider.initialize();
        console.log("✅ Initial indexing complete.");
    });
}

export function deactivate() {}