import * as vscode from 'vscode';
import { CodeGraph } from '../code-graph';
import * as path from 'path';

/**
 * ======================================================================================
 * [TROUBLESHOOTING LOG / 開発ログ]
 * ======================================================================================
 * * 1. ファイルジャンプ機能の実装 (File Opening)
 * - 現象: "Failed to open file: test_sample.py" というエラーが出てファイルが開かない。
 * - 原因: openTextDocument API は絶対パスを要求するが、DBから取得したパスが相対パス（ファイル名のみ）だったため。
 * - 解決策: path.isAbsolute() で判定し、相対パスの場合はワークスペースのルートURIと結合して絶対パスに変換するロジックを追加。
 * * 2. Webviewの状態維持 (State Retention)
 * - 現象: エディタへジャンプした後、グラフに戻ってくると再読み込み（リセット）されてしまう。
 * - 原因: VS CodeのWebviewはデフォルトで非表示時に破棄され、再表示時に初期化される仕様のため。
 * - 解決策: createWebviewPanel のオプションに `retainContextWhenHidden: true` を追加し、バックグラウンドでも状態を維持するように設定。
 * ======================================================================================
 */

export class CodeGraphPanel {
    public static currentPanel: CodeGraphPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _codeGraph: CodeGraph;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, codeGraph: CodeGraph) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._codeGraph = codeGraph;

        // WebviewのHTMLを設定
        this._panel.webview.html = this._getWebviewContent(this._panel.webview);

        // クリーンアップ
        this._panel.onDidDispose(() => this.dispose(), null, []);

        // メッセージ受信 (Frontend -> Backend)
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'REQUEST_INIT':
                        await this._sendGraphData();
                        return;
                    
                        case 'JUMP_TO_CODE':
                        try {
                            let fileUri: vscode.Uri;
                            const rawPath = message.path;

                            // パスが絶対パスかどうか判定し、URIを作成
                            if (path.isAbsolute(rawPath)) {
                                fileUri = vscode.Uri.file(rawPath);
                            } else {
                                // 相対パスの場合、ワークスペースのルートと結合して絶対パスにする
                                if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                                    fileUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, rawPath);
                                } else {
                                    // ワークスペースがない場合はそのまま試みる（うまくいかない可能性が高いが）
                                    fileUri = vscode.Uri.file(rawPath);
                                }
                            }

                            // 行番号 (VS Codeは0始まりなので -1 する)
                            const line = message.line ? message.line - 1 : 0;

                            // ファイルを開く
                            const doc = await vscode.workspace.openTextDocument(fileUri);
                            const editor = await vscode.window.showTextDocument(doc);

                            // 指定行へスクロールとカーソル移動
                            const position = new vscode.Position(line, 0);
                            const range = new vscode.Range(position, position);
                            
                            editor.selection = new vscode.Selection(position, position);
                            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                            
                        } catch (error) {
                            vscode.window.showErrorMessage(`Failed to open file: ${message.path}`);
                            console.error(error);
                        }
                        return;
                }
            },
            null,
            []
        );
    }

    public static createOrShow(extensionUri: vscode.Uri, codeGraph: CodeGraph) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // 既にパネルが開いていればフォーカスする
        if (CodeGraphPanel.currentPanel) {
            CodeGraphPanel.currentPanel._panel.reveal(column);
            return;
        }

        // 新しいパネルを作成
        const panel = vscode.window.createWebviewPanel(
            'codeContextGraph',
            'Code Context Graph',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true, // Reactを実行するために必要
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
                retainContextWhenHidden: true
            }
        );

        CodeGraphPanel.currentPanel = new CodeGraphPanel(panel, extensionUri, codeGraph);
    }

    private async _sendGraphData() {
        // DBからグラフデータを取得
        const data = await this._codeGraph.getNetwork();
        // Frontendへ送信
        this._panel.webview.postMessage({ command: 'UPDATE_GRAPH', data });
    }

    public dispose() {
        CodeGraphPanel.currentPanel = undefined;
        this._panel.dispose();
    }

    private _getWebviewContent(webview: vscode.Webview) {
        // Viteでビルドされたファイルへのパス (dist/assets/index.js / index.css)
        // ※ Viteのビルド設定によってはファイル名にハッシュが付くため、
        //   実運用では glob で検索するか、固定名にする設定が必要。
        //   一旦、固定名と仮定して記述します。
        
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'assets', 'index.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'assets', 'index.css'));

        // CSP (Content Security Policy) の設定
        const nonce = getNonce();

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
                <link href="${styleUri}" rel="stylesheet">
                <title>Code Context Graph</title>
            </head>
            <body>
                <div id="root"></div>
                <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}