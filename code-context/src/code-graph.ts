import * as path from 'path';
import * as fs from 'fs';
import * as util from 'util';

/**
 * ======================================================================================
 * [TROUBLESHOOTING LOG / 開発ログ]
 * ======================================================================================
 * 過去に発生したエラーと解決策のアーカイブです。保守時の参考にしてください。
 *
 * 1. Node.js環境でのPolyfill (Environment Polyfills)
 * - エラー: "ReferenceError: TextEncoder is not defined"
 * - エラー: "TypeError: Cannot read properties of undefined (reading 'length')" (CozoDB内部)
 * - 原因: Wasm版CozoDBはブラウザ環境（グローバルスコープ）を前提としているが、Node.jsには標準で存在しないため。
 * - 解決策: TextEncoder/Decoder および self/window をグローバルに手動で割り当てる。
 *
 * 2. CommonJS環境でのESMパッケージ読み込み (ESM Loading)
 * - エラー: "Cannot find module 'cozo-lib-wasm'"
 * - 原因: VS Code拡張機能はCommonJSで動作するが、このパッケージはESM形式のみ提供されているため。
 * - 解決策: `new Function('return import(...)')` を使用し、TSコンパイラがrequire()に変換するのを回避して動的インポートを行う。
 * ======================================================================================
 */

/**
 * Polyfills for Node.js environment
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

    /**
     * [トラブルシューティング・ログ: CozoDBのエラーハンドリング]
     * - エラー: "沈黙の失敗" (ログ上は初期化成功と出るが、実際にはテーブルが作成されていない)。
     * - 原因: db.run() は失敗時に例外を投げず、単に { "ok": false } を含むJSON文字列を返す仕様であるため。
     * - 解決策: 戻り値を必ずパースし、result.ok が false の場合は明示的に Error を投げるラッパーを作成。
     * - 検知方法: result.ok を明示的にチェックする。
     */
    private async runCommand(query: string, params: object = {}): Promise<any> {
        if (!this.db) throw new Error("Database not initialized");
        
        const resultStr = await this.db.run(query, JSON.stringify(params));
        const result = JSON.parse(resultStr);

        if (result.ok === false) {
            // エラー内容を詳細にログ出力
            console.error(`❌ CozoDB Error in query: ${query.substring(0, 50)}...`);
            console.error(`Reason: ${JSON.stringify(result)}`);
            throw new Error(result.message || result.display || "CozoDB Query Failed");
        }
        return result;
    }

    async init() {
        if (this.isInitialized) { return; }

        console.log("⚙️ Initializing CodeGraph...");
        
        try {
            // パスではなくパッケージ名で読み込む
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

            // スキーマ作成（エラーチェック付き実行）
            // テーブルが既に存在する場合のエラーを避けるため、一旦削除するか、作成前にチェックするのが理想ですが、
            // インメモリDBなので起動時は常に空です。
            const schemas = [
                `:create files { path: String => language: String, last_modified: Float }`,
                `:create symbols { id: String => file_path: String, name: String, kind: String, start_line: Int, end_line: Int }`,
                `:create relations { from_id: String, to_id: String, type: String => count: Int }`
            ];

            /**
             * [トラブルシューティング・ログ: スキーマ作成]
             * - エラー: "relation_not_found" (最後のテーブルしか作成されない)。
             * - 原因: 複数の ":create" 文を1つの db.run() 呼び出しで送ると、最後の一文しか実行されない挙動があったため。
             * - 解決策: create文ごとにループを回し、個別に db.run() を実行するように変更。
             */

            for (const q of schemas) {
                await this.runCommand(q);
            }
            
            this.isInitialized = true;
            console.log("✅ Database initialized successfully.");

        } catch (error) {
            console.error("❌ Initialization Failed:", error);
            // 初期化失敗時はフラグを立てない
            this.isInitialized = false;
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
                        // 注意: ここのIDは 'name' そのものだが、定義側は 'path:name' になっているため
                        // そのままでは繋がらない。getNetwork側でフィルタリングすることでクラッシュを防ぐ。
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

            // DB Upsert (エラーチェック付き)
            // データ内にシングルクォートが含まれるとクエリが壊れるため、簡易エスケープが必要ですが
            // MVPでは一旦そのまま進めます（本格対応時はパラメータバインディングを使用すべき）
            if (fileRows.length > 0) {
                await this.runCommand(`?[path, language, last_modified] <- [${fileRows.join(',')}] :put files`);
            }
            if (symbolRows.length > 0) {
                await this.runCommand(`?[id, file_path, name, kind, start_line, end_line] <- [${symbolRows.join(',')}] :put symbols`);
            }
            if (relations.length > 0) {
                await this.runCommand(`?[from_id, to_id, type, count] <- [${relations.join(',')}] :put relations`);
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
            // runCommandを使わず、呼び出し元で処理しやすいように生の結果をパースして返す
            const jsonStr = await this.db.run(datalog, "{}");
            return JSON.parse(jsonStr);
        } catch (e) {
            console.error("Query execution error:", e);
            return { ok: false, rows: [], error: e };
        }
    }

    /**
     * [トラブルシューティング・ログ: グラフ可視化ロジック]
     * 1. 不正なエッジによるクラッシュ
     * - エラー: "Can not create edge ... with nonexistant target"
     * - 原因: 外部ライブラリ呼び出し（例: "d.strip"）など、定義ノードが存在しないIDへエッジを張ろうとするとCytoscapeがクラッシュする。
     * - 解決策: getNetwork() 内で、SourceとTargetの両方が validNodeIds に存在する場合のみエッジを追加するフィルタリングを実装。
     * * 2. 関数呼び出しエッジの欠落
     * - 現象: 関数呼び出し（例: main -> load_data）の線が表示されない。
     * - 原因: 呼び出し元は単純な関数名（例: "load_data"）を使用していたが、定義側のIDは "file:load_data" であり、文字列が一致しなかった。
     * - 解決策: 名前解決ロジック（nameToIds マップ）を実装し、関数名から適切なノードIDを検索して紐付けるようにした。
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
            // シンボル情報に file_path も含めて取得する（同一ファイルの優先解決のため）
            const symbolsQuery = `?[id, kind, label, file] := *symbols[id, file, name, kind, _, _], label = name`;

            // エッジ取得
            const relationsQuery = `?[source, target, type] := *relations[source, target, type, _]`;

            const files = await this.query(filesQuery);
            const symbols = await this.query(symbolsQuery);
            const relations = await this.query(relationsQuery);

            const nodes: any[] = [];
            const edges: any[]  = [];
            
            // 存在するノードIDのセット（検証用）
            const validNodeIds = new Set<string>();
            const nameToIds: Record<string, any[]> = {};

            // Helper to add to name index
            const addToIndex = (name: string, id: string, file: string) => {
                if (!nameToIds[name]) nameToIds[name] = [];
                nameToIds[name].push({ id, file });
            };

            if (files.ok && files.rows) {
                files.rows.forEach((row: any[]) => {
                    const [id, kind, label] = row;
                    nodes.push({ data: { id, kind, label } });
                    validNodeIds.add(id);
                    // ファイル名自体もインデックスに入れておく（import解決用など）
                    addToIndex(path.basename(id, path.extname(id)), id, id); 
                });
            }
            if (symbols.ok && symbols.rows) {
                symbols.rows.forEach((row: any[]) => {
                    const [id, kind, label, file] = row;
                    nodes.push({ data: { id, kind, label } });
                    validNodeIds.add(id);
                    addToIndex(label, id, file);
                });
            }

            // 2. エッジの解決
            if (relations.ok && relations.rows) {
                relations.rows.forEach((row: any[]) => {
                    const sourceId = row[0];
                    const rawTarget = row[1]; // これが "load_data" や "processor.clean" になっている
                    const type = row[2];

                    if (type === 'contains') {
                        // Containsは既に正しいIDなのでそのまま追加
                        if (validNodeIds.has(sourceId) && validNodeIds.has(rawTarget)) {
                            const edgeId = `${sourceId}-${type}-${rawTarget}`;
                            edges.push({ data: { id: edgeId, source: sourceId, target: rawTarget, type } });
                        }
                    } else if (type === 'call') {
                        // Callは名前解決を試みる
                        // 1. そのままの名前で検索 (例: "DataProcessor")
                        // 2. ドットで分割して末尾で検索 (例: "processor.clean" -> "clean")
                        const targetName = rawTarget.split('.').pop() || rawTarget;
                        const candidates = nameToIds[targetName];

                        if (candidates) {
                            // 候補が見つかった場合
                            // ヒューリスティック: 呼び出し元と同じファイルの候補を優先する
                            // (sourceId自体が "filepath:name" 形式か、 "filepath" そのもの)
                            const sourceFile = sourceId.includes(':') ? sourceId.split(':')[0] : sourceId;
                            
                            let bestMatch = candidates.find(c => c.file === sourceFile);
                            
                            // 同一ファイルの候補があればそれにリンク、なければ最初の候補にリンク（簡易実装）
                            const targetId = bestMatch ? bestMatch.id : candidates[0].id;
                            
                            const edgeId = `${sourceId}-call-${targetId}`;
                            // 重複防止
                            if (!edges.find(e => e.data.id === edgeId)) {
                                edges.push({ data: { id: edgeId, source: sourceId, target: targetId, type: 'call' } });
                            }
                        }
                    } else if (type === 'import') {
                         // Importも簡易的に名前解決
                         const targetName = rawTarget.split('.').pop() || rawTarget;
                         const candidates = nameToIds[targetName];
                         // importの場合はファイルノードまたはクラスノードへリンクしたい
                         // MVPでは "ファイル名" と一致する場合のみリンクさせる等の制限も可
                         if (candidates) {
                             const targetId = candidates[0].id; // 暫定：最初の候補
                             const edgeId = `${sourceId}-import-${targetId}`;
                             if (!edges.find(e => e.data.id === edgeId)) {
                                 edges.push({ data: { id: edgeId, source: sourceId, target: targetId, type: 'import' } });
                             }
                         }
                    }
                });
            }

            return { nodes, edges };

        } catch (e) {
            console.error("Failed to get network:", e);
            return { nodes: [], edges: [] };
        }
    }
}