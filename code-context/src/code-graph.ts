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

            // 2. CozoDB の読み込み
            const { initSync, CozoDb } = require('cozo-lib-wasm');
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
                :create files { path: String => language: String }
                :create symbols { file_path: String, name: String, kind: String => start_line: Int, end_line: Int }
            `;
            await this.db.run(schemaQuery, "{}");
            
            this.isInitialized = true;

        } catch (error) {
            console.error("❌ Initialization Failed:", error);
        }
    }

    async processFile(filePath: string, content: string) {
        // 安全装置
        if (!this.isInitialized || !this.db) {
            console.error("Database not ready, skipping:", filePath);
            return;
        }

        const ext = path.extname(filePath);
        let langKey = '';
        if (ext === '.py') {langKey = 'python';}
        else if (ext === '.ts' || ext === '.tsx') {langKey = 'typescript';}
        else {return;}

        if (!this.languages[langKey]) {
            console.warn(`Language not loaded for ${filePath}`);
            return;
        }
        this.parser.setLanguage(this.languages[langKey]);

        try {
            const tree = this.parser.parse(content);
            
            // ファイル自体の登録
            await this.db.run(`?[path, language] <- [['${filePath}', '${langKey}']] :put files`, "{}");

            const transactions: any[] = [];
            const traverse = (node: any) => {
                const targetTypes = [
                    'function_definition', 'class_definition', // Python
                    'function_declaration', 'class_declaration', 'interface_declaration', 'method_definition' // TypeScript
                    // 'export_statement' は名前を持たないので除外しました
                ];

                // ノードの種類が対象、かつ名前(name)を持っているかチェック
                if (targetTypes.includes(node.type)) {
                    const nameNode = node.childForFieldName('name');
                    if (nameNode) {
                        let kind = 'unknown';
                        if (node.type.includes('function') || node.type.includes('method')) {kind = 'function';}
                        else if (node.type.includes('class')) {kind = 'class';}
                        else if (node.type.includes('interface')) {kind = 'interface';}

                        transactions.push([filePath, nameNode.text, kind, node.startPosition.row, node.endPosition.row]);
                    }
                }
                
                // 子ノードを再帰的に探索
                for (let i = 0; i < node.childCount; i++) {
                    traverse(node.child(i));
                }
            };

            traverse(tree.rootNode);

            // ▼▼▼ ログ追加: 何個見つかったか表示 ▼▼▼
            if (transactions.length > 0) {
                console.log(`💾 Saved ${transactions.length} symbols from ${filePath}`);
                const dataStr = JSON.stringify(transactions);
                const query = `?[file_path, name, kind, start_line, end_line] <- ${dataStr} :put symbols`;
                await this.db.run(query, "{}");
            } else {
                console.log(`⚠️ No symbols found in ${filePath} (Tree: ${tree.rootNode.type})`);
            }
            // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

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
        const jsonStr = await this.db.run(datalog, "{}");
        return JSON.parse(jsonStr);
    }
}