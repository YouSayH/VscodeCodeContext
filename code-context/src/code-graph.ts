import * as path from 'path';
import * as fs from 'fs';
import * as util from 'util';

/**
 * ======================================================================================
 * [TROUBLESHOOTING LOG 1: Node.js Environment Polyfills]
 * ======================================================================================
 * ■ エラー内容: 
 * "ReferenceError: TextEncoder is not defined" や
 * "TypeError: Cannot read properties of undefined (reading 'length')" (CozoDB内部)
 * * ■ 原因:
 * CozoDB (wasm-bindgen) はブラウザ環境を想定しており、グローバルな `self` や
 * `TextEncoder` が存在することを前提にコードが生成されているため。
 * Node.js にはこれらが標準ではないため、実行時にクラッシュする。
 * * ■ 解法:
 * 以下のコードで環境を「偽装」する。
 * ======================================================================================
 */
const polyfills = {
    TextEncoder: util.TextEncoder,
    TextDecoder: util.TextDecoder,
};
Object.assign(global, polyfills);
(global as any).self = global;
(global as any).window = global;

export class CodeGraph {
    private db: any;
    private parser: any;
    private wasmDir: string;
    private isInitialized: boolean = false;
    private languages: Record<string, any> = {};

    constructor(wasmDir: string) {
        this.wasmDir = wasmDir;
    }


    async init() {
        if (this.isInitialized) {return;}

        console.log("⚙️ Initializing CodeGraph...");
        
        try {
            // 【修正点】 パスではなくパッケージ名で読み込む
            // これなら esbuild でバンドルされても解決できます
            // 1. Tree-sitter の読み込み
            const TSModule = require('web-tree-sitter');
            const Parser = TSModule.Parser;
            const Language = TSModule.Language;

            await Parser.init({ locateFile: (f: string) => path.join(this.wasmDir, f) });
            this.parser = new Parser();

            // 言語Wasmの読み込み
            const pyFile = path.join(this.wasmDir, 'tree-sitter-python.wasm');
            this.languages['python'] = await Language.load(pyFile);

            const tsFile = path.join(this.wasmDir, 'tree-sitter-typescript.wasm');
            if (fs.existsSync(tsFile)) {
                this.languages['typescript'] = await Language.load(tsFile);
            }

            /**
             * ======================================================================================
             * [TROUBLESHOOTING LOG 3: ESM Package Loading in Node.js (CommonJS)]
             * ======================================================================================
             * ■ エラー: "Error: Cannot find module 'cozo-lib-wasm'"
             * ■ 原因:
             * `cozo-lib-wasm` は ESM 形式のみだが、現在の環境(ts-node/CommonJS)では `require()` が使われる。
             * TypeScript上で `import(...)` と書いても `require()` に変換されてしまい詰む。
             * ■ 解決策:
             * `new Function(...)` を使い、Nativeの `import()` を強制的に呼び出すハックを使用。
             * * [TROUBLESHOOTING LOG 4: Package Export Resolution]
             * ======================================================================================
             * ■ エラー: "Error: Cannot find package '.../index.js'"
             * ■ 原因:
             * Node.js がパッケージのエントリーポイントを解決できず、index.js を探して失敗した。
             * ■ 解決策:
             * パッケージ名だけでなく、実体ファイル名('cozo_lib_wasm.js')まで明示的に指定してインポートする。
             * ======================================================================================
             */
            const dynamicImport = new Function('specifier', 'return import(specifier)');
            // const cozoPkg = await dynamicImport('cozo-lib-wasm');
            const cozoPkg = await dynamicImport('cozo-lib-wasm/cozo_lib_wasm.js');
            const { initSync, CozoDb } = cozoPkg;

            const cozoWasmPath = path.join(this.wasmDir, 'cozo_lib_wasm_bg.wasm');
            
            if (!fs.existsSync(cozoWasmPath)) {
                console.error(`❌ CozoDB Wasm not found at: ${cozoWasmPath}`);
                return;
            }

            const wasmBuffer = fs.readFileSync(cozoWasmPath);
            initSync(wasmBuffer);
            
            this.db = CozoDb.new();
            console.log("✅ Database initialized:", !!this.db);

            // スキーマ作成
            const schemaQuery = `
                :create files { path: String => language: String, last_modified: Float }
                :create symbols { id: String => file_path: String, name: String, kind: String, start_line: Int, end_line: Int }
                :create relations { from_id: String, to_id: String, type: String => count: Int }
            `;
            await this.db.run(schemaQuery, "{}");
            
            this.isInitialized = true;
            console.log("✅ Database initialized:", !!this.db);

        } catch (error) {
            console.error("❌ Initialization Failed:", error);
        }
    }

    private generateId(filePath: string, name: string): string {
        return `${filePath}:${name}`;
    }



    async processFile(filePath: string, content: string, lastModified: number = Date.now()) {
        if (!this.isInitialized || !this.db) return;

        const ext = path.extname(filePath);
        let langKey = '';
        if (ext === '.py') { langKey = 'python'; }
        else { return; } // MVPはPython優先

        if (!this.languages[langKey]) return;
        this.parser.setLanguage(this.languages[langKey]);

        try {
            const tree = this.parser.parse(content);

            // データ収集用配列
            const fileRows: string[] = [`['${filePath}', '${langKey}', ${lastModified}]`];
            const symbolRows: string[] = [];
            const relations: string[] = [];
            
            // Scope Stack: 現在の親ノードID (最初はファイルパス)
            const scopeStack: string[] = [filePath]; 

            const traverseAndCollect = (node: any) => {
                let pushedScope = false;
                let currentId = null;

                // 1. Symbol & Contains Edge
                if (['function_definition', 'class_definition'].includes(node.type)) {
                    const nameNode = node.childForFieldName('name');
                    if (nameNode) {
                        const name = nameNode.text;
                        const kind = node.type.includes('class') ? 'class' : 'function';
                        currentId = this.generateId(filePath, name);
                        
                        symbolRows.push(`['${currentId}', '${filePath}', '${name}', '${kind}', ${node.startPosition.row}, ${node.endPosition.row}]`);
                        
                        const parentId = scopeStack[scopeStack.length - 1];
                        relations.push(`['${parentId}', '${currentId}', 'contains', 1]`);
                        
                        scopeStack.push(currentId);
                        pushedScope = true;
                    }
                }

                // 2. Import Edge
                if (node.type === 'import_statement') {
                     node.children.forEach((c: any) => {
                         if (c.type === 'dotted_name') {
                             relations.push(`['${filePath}', '${c.text}', 'import', 1]`);
                         }
                     });
                }
                if (node.type === 'import_from_statement') {
                    // from X import Y -> Xを依存先とする
                    const modNode = node.children.find((c: any) => c.type === 'dotted_name' || c.type === 'identifier'); 
                    if (modNode) {
                        relations.push(`['${filePath}', '${modNode.text}', 'import', 1]`);
                    }
                }

                /**
                 * ======================================================================================
                 * [TROUBLESHOOTING LOG 5: Tree-sitter Node Types]
                 * ======================================================================================
                 * ■ 症状: 関数呼び出しのエッジ(Call Edge)が検出数0件になる。
                 * ■ 原因:
                 * 'call_expression' だけをチェックしていたが、Pythonの文法定義(tree-sitter-python)では
                 * 通常の関数呼び出しが単純に 'call' というタイプになる場合がある。
                 * ■ 解決策:
                 * OR条件を追加し、node.type === 'call' も許容するように変更。
                 * ======================================================================================
                 */
                if (node.type === 'call_expression' || node.type === 'call') {
                    const funcNode = node.childForFieldName('function');
                    if (funcNode) {
                        const callerId = scopeStack[scopeStack.length - 1];
                        // 呼び出し先を文字列として保存
                        relations.push(`['${callerId}', '${funcNode.text}', 'call', 1]`);
                    }
                }

                // Recurse
                for (let i = 0; i < node.childCount; i++) {
                    traverseAndCollect(node.child(i));
                }

                if (pushedScope) {
                    scopeStack.pop();
                }
            };

            traverseAndCollect(tree.rootNode);

            // DB Upsert
            if (fileRows.length > 0) {
                await this.db.run(`?[path, language, last_modified] <- [${fileRows.join(',')}] :put files`, "{}");
            }
            if (symbolRows.length > 0) {
                await this.db.run(`?[id, file_path, name, kind, start_line, end_line] <- [${symbolRows.join(',')}] :put symbols`, "{}");
            }
            if (relations.length > 0) {
                await this.db.run(`?[from_id, to_id, type, count] <- [${relations.join(',')}] :put relations`, "{}");
            }

            console.log(`💾 Processed ${filePath}: ${symbolRows.length} symbols, ${relations.length} relations.`);

        } catch (e) {
            console.error(`Error processing ${filePath}:`, e);
        }
    }



    /**
     * ======================================================================================
     * [TROUBLESHOOTING LOG 2: CozoDB Return Type]
     * ======================================================================================
     * ■ エラー内容: 
     * 呼び出し元で "No symbols detected" になる（result.ok が undefined）。
     * * ■ 原因:
     * CozoDBの `run` メソッドは、オブジェクトではなく「JSON形式の文字列」を返す仕様。
     * JSのオブジェクトだと思って `result.ok` にアクセスしても値が取れなかった。
     * * ■ 見つけ方:
     * `console.log(typeof result)` を実行したところ 'string' と表示されたことで発覚。
     * * ■ 解法:
     * 必ず `JSON.parse()` してから返すラッパーメソッドを通すようにする。
     * ======================================================================================
     */
    async query(datalog: string) {
        if (!this.isInitialized || !this.db) {
            return { ok: false, rows: [] };
        }
        try {
            const jsonStr = await this.db.run(datalog, "{}");
            return JSON.parse(jsonStr);
        } catch (e) {
            console.error("Query failed:", e);
            return { ok: false, rows: [], error: e };
        }
    }

    /**
     * Cytoscape.js 用のグラフデータを取得する
     */
    async getNetwork() {
        if (!this.isInitialized || !this.db) {
            return { nodes: [], edges: [] };
        }

        try {
            // 1. 全ノード取得 (Files & Symbols)
            // files: path, language
            // symbols: id, kind, name
            const filesQuery = `?[id, kind, label] := *files[id, language, _], kind = "file", label = id`;
            const symbolsQuery = `?[id, kind, label] := *symbols[id, _, name, kind, _, _], label = name`;
            
            // 2. 全エッジ取得 (Relations)
            // idは一意にする必要があるため "from-type-to" のような形式にする
            const edgesQuery = `?[id, source, target, type] := *relations[source, target, type, _], id = source ++ "-" ++ type ++ "-" ++ target`;

            // クエリ実行
            const files = await this.query(filesQuery);
            const symbols = await this.query(symbolsQuery);
            const relations = await this.query(edgesQuery);

            const nodes: any[] = [];
            const edges: any[]  = [];

            // ノードの整形
            if (files.rows) {
                files.rows.forEach((row: any[]) => {
                    nodes.push({ data: { id: row[0], kind: row[1], label: row[2] } });
                });
            }
            if (symbols.rows) {
                symbols.rows.forEach((row: any[]) => {
                    nodes.push({ data: { id: row[0], kind: row[1], label: row[2] } });
                });
            }

            // エッジの整形
            if (relations.rows) {
                relations.rows.forEach((row: any[]) => {
                    edges.push({ data: { id: row[0], source: row[1], target: row[2], type: row[3] } });
                });
            }

            return { nodes, edges };

        } catch (e) {
            console.error("Failed to get network:", e);
            return { nodes: [], edges: [] };
        }
    }
}