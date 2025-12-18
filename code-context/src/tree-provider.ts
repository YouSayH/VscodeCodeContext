import * as vscode from 'vscode';
import * as path from 'path';
import { CodeGraph } from './code-graph';

export class CodeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly filePath: string,
        public readonly line: number,
        public readonly type: 'file' | 'symbol'
    ) {
        super(label, collapsibleState);

        if (type === 'file') {
            this.iconPath = vscode.ThemeIcon.File;
            this.resourceUri = vscode.Uri.file(filePath);
        } else {
            this.iconPath = new vscode.ThemeIcon(
                label.includes('(class)') ? 'symbol-class' : 
                label.includes('(interface)') ? 'symbol-interface' : 'symbol-method'
            );
            
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [
                    vscode.Uri.file(filePath),
                    { selection: new vscode.Range(line, 0, line, 0) }
                ]
            };
        }
    }
}

export class CodeContextProvider implements vscode.TreeDataProvider<CodeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<CodeItem | undefined | null | void> = new vscode.EventEmitter<CodeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<CodeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private graph: CodeGraph;
    private workspaceRoot: string;

    constructor(rootPath: string, wasmDir: string) {
        this.workspaceRoot = rootPath;
        this.graph = new CodeGraph(wasmDir);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    async initialize() {
        await this.graph.init();
        
        const glob = require('glob');

        /**
         * ======================================================================================
         * [TROUBLESHOOTING LOG: Windows Path Issue]
         * ======================================================================================
         * ■ Error: "Found 2891 files" (node_modulesが含まれる) や、DB保存後の表示ゼロ件。
         * ■ Cause: Windowsのパス区切り文字 `\` が、globパターンやCozoDBの文字列リテラル内で
         * エスケープ文字として誤解釈され、マッチングや除外設定が機能しない。
         * ■ Fix:   `.replace(/\\/g, '/')` を使用して、全てのパス処理を「POSIX形式（スラッシュ）」に統一する。
         * ======================================================================================
         */

        const rootPathPosix = this.workspaceRoot.replace(/\\/g, '/');
        
        const files = glob.sync('**/*.{py,ts,tsx}', {
            cwd: rootPathPosix,
            ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/out/**', '**/webview-ui/**'],
            absolute: true,
            nodir: true
        });

        console.log(`📄 Found ${files.length} files to index.`);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Indexing Codebase...",
            cancellable: false
        }, async (progress) => {
            let count = 0;
            for (const file of files) {
                const fs = require('fs');
                try {
                    const content = fs.readFileSync(file, 'utf-8');
                    const relativePath = path.relative(this.workspaceRoot, file).replace(/\\/g, '/');
                    await this.graph.processFile(relativePath, content);
                } catch(e) { console.error(e); }
                
                count++;
                progress.report({ message: `${count}/${files.length} files`, increment: 100 / files.length });
            }
        });
        
        console.log("✅ Indexing finished. Triggering refresh...");
        this.refresh();
    }

    getTreeItem(element: CodeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: CodeItem): Promise<CodeItem[]> {
        console.log(`🌲 getChildren called. Element: ${element ? element.label : 'ROOT'}`);

        if (!element) {

            /**
             * ======================================================================================
             * [TROUBLESHOOTING LOG: Datalog Query Error / Table Mismatch]
             * ======================================================================================
             * ■ Error 1: "Unexpected input ... :distinct"
             * -> Cause: CozoDB Datalogには `:distinct` という構文はない。
             * ■ Error 2: "Cannot find requested stored relation 'files'"
             * -> Cause: `files` テーブルへの保存がパス問題等で失敗している場合があるが、
             * `symbols` テーブルは成功しているケースがあった。
             * ■ Fix:   
             * 1. 確実にデータがある `symbols` テーブルからファイル一覧を取得する。
             * 2. Datalog側での重複排除を諦め、JS側の `Set` で重複を削除する（確実性が高い）。
             * ======================================================================================
             */

            const result = await this.graph.query(`
                ?[file] := *symbols{file_path: file}
                :order file
            `);
            
            if (!result.ok) {
                console.error("Query Failed:", result);
                return [];
            }

            // JavaScript側で重複を削除する (Setを使う)
            const rawFiles = result.rows.map((row: any) => row[0]);
            const distinctFiles = Array.from(new Set(rawFiles)) as string[];

            return distinctFiles.map((filePath: string) => {
                return new CodeItem(
                    filePath,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    path.join(this.workspaceRoot, filePath),
                    0,
                    'file'
                );
            });

        } else if (element.type === 'file') {
            // ファイルレベル: シンボル一覧
            const result = await this.graph.query(`
                ?[name, kind, line] := *symbols{file_path: "${element.label}", name, kind, start_line: line}
                :order line
            `);

            if (!result.ok) {return [];}

            return result.rows.map((row: any) => {
                const [name, kind, line] = row;
                return new CodeItem(
                    name,
                    vscode.TreeItemCollapsibleState.None,
                    element.filePath,
                    line,
                    'symbol'
                );
            });
        }
        return [];
    }
}