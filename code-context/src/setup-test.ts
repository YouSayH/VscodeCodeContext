/**
 * ======================================================================================
 * SETUP TEST & TROUBLESHOOTING LOG
 * ======================================================================================
 * * このファイルは、Tree-sitter (解析器) と CozoDB (グラフDB) を Node.js 環境で
 * 動作させるための検証用スクリプトです。
 * * 開発中に遭遇したエラーと解決策を以下に記録します。
 */

import * as path from 'path';
// ==========================================
// [BEFORE] 以前はここで個別のライブラリやPolyfill用モジュールが必要でした
// import * as fs from 'fs';
// import * as util from 'util';
//
// [AFTER] 今は自作した "CodeGraph" クラスひとつで完結します
import { CodeGraph } from './code-graph';
// ==========================================




// --------------------------------------------------------------------------------------
// [トラブルシューティング 1: 環境変数の不足]
// --------------------------------------------------------------------------------------
// ■ エラー内容: 
//   ReferenceError: TextEncoder is not defined
//   または、CozoDB内部での "Cannot read properties of undefined"
//
// ■ 原因:
//   CozoDBのWasmグルーコード（JS）はブラウザ環境を想定しており、
//   'self', 'window', 'TextEncoder' がグローバルに存在すること前提で作られている。
//   Node.jsにはこれらが標準でグローバルにないため、スクリプトがクラッシュする。
//
// ■ 解決策:
//   Node.jsの `util` モジュールを使ってポリフィル（偽装）を行う。
// --------------------------------------------------------------------------------------



// ==========================================
// [BEFORE] Node.jsで動かすための長い「環境偽装(Polyfill)」コードがここにありました
//
// const polyfills = {
//     TextEncoder: util.TextEncoder,
//     TextDecoder: util.TextDecoder,
// };

// // グローバル空間に無理やり登録
// Object.assign(global, polyfills);
// (global as any).self = global;   // Wasmが 'self' を探しに来た時の対策
// (global as any).window = global; // 'window' を探しに来た時の対策

// console.log("🛠️  Environment Polyfilled: TextEncoder is available.");
// [AFTER] CodeGraphクラスの内部（code-graph.ts）に隠蔽されたため、ここは不要です
// ==========================================

async function test() {
    console.log("🚀 Starting Setup Test (Documented Version)...");
    const wasmDir = path.resolve(__dirname, '../wasm');

    try {
        // ----------------------------------------------------------------------------------
        // [トラブルシューティング 2: web-tree-sitter のインポート問題]
        // ----------------------------------------------------------------------------------
        // ■ エラー内容: TypeError: Parser.init is not a function
        // ■ 原因: 
        //   CommonJS形式のライブラリのため、`import Parser from ...` だと
        //   クラスが `default` や `Parser` プロパティの中に隠れてしまう。
        // ■ 発見方法: `console.log(Object.keys(TSModule))` で中身を表示して構造を確認。
        // ■ 解決策: `require` を使い、プロパティから明示的にクラスを取り出す。
        // ----------------------------------------------------------------------------------


    // ==========================================
    // [BEFORE] 手動セットアップ
    // ------------------------------------------

        // const parserPath = path.join(__dirname, '../node_modules/web-tree-sitter/web-tree-sitter.cjs');
        // const TSModule = require(parserPath);
        // const Parser = TSModule.Parser;     // 階層の奥にあるクラスを取り出す
        // const Language = TSModule.Language; // 同様にLanguageクラスも取り出す

        // await Parser.init({ locateFile: (f: string) => path.join(wasmDir, f) });
        // const parser = new Parser();
        
        // const langFile = path.join(wasmDir, 'tree-sitter-python.wasm');
        // const Python = await Language.load(langFile);
        // parser.setLanguage(Python);
        // console.log("✅ Tree-sitter loaded.");


        // // ----------------------------------------------------------------------------------
        // // [トラブルシューティング 3: CozoDB Wasm の初期化タイミング]
        // // ----------------------------------------------------------------------------------
        // // ■ エラー内容: TypeError: CozoDb.new_from_memory is not a function
        // // ■ 原因:
        // //   1. バージョンアップで `new_from_memory` が `new` に改名されていた。
        // //   2. Node.js環境ではWasmが自動ロードされないため、クラスはあるが中身が空だった。
        // // ■ 発見方法: `Object.keys(CozoDb)` でメソッド一覧を表示し、`new` しかないことを確認。
        // // ■ 解決策: `fs` でファイルを読み込み、`initSync` で同期的に初期化する。
        // // ----------------------------------------------------------------------------------
        // console.log("Initializing CozoDB...");
        // const cozoJSPath = path.join(__dirname, '../node_modules/cozo-lib-wasm/cozo_lib_wasm.js');
        // const { initSync, CozoDb } = require(cozoJSPath);
        
        // const cozoWasmPath = path.join(wasmDir, 'cozo_lib_wasm_bg.wasm');
        // const wasmBuffer = fs.readFileSync(cozoWasmPath);
        
        // // Wasmバイナリをメモリに展開（これでCozoDbクラスが機能し始める）
        // initSync(wasmBuffer);

        // const db = CozoDb.new(); 
        // console.log("✅ CozoDB instance created.");


        // // ----------------------------------------------------------------------------------
        // // [トラブルシューティング 4: 引数不足による内部クラッシュ]
        // // ----------------------------------------------------------------------------------
        // // ■ エラー内容: 
        // //   TypeError: Cannot read properties of undefined (reading 'length')
        // //   at passStringToWasm0 (node_modules/.../cozo_lib_wasm.js:77)
        
        // // ■ 原因:
        // //   `db.run(query)` だけだと、内部処理が第2引数（params）の長さを測ろうとして
        // //   `undefined.length` になりクラッシュしていた。
        
        // // ■ 発見方法: 
        // //   PowerShellで `Get-Content ... | Select-Object -Index (70..90)` を実行し、
        // //   エラー発生行のソースコードを直接確認した。
        
        // // ■ 解決策: 第2引数に空のパラメータ "{}" を渡す。
        // // ----------------------------------------------------------------------------------


    // ==========================================
    // [AFTER] クラス利用
    // ------------------------------------------
    // インスタンス化して init() を呼ぶだけで、上記の複雑な処理が完了します
    const graph = new CodeGraph(wasmDir);
    // ==========================================

    await graph.init();

        // テスト用のダミーコード
        const dummyFile = "example.py";
        const dummyCode = `
class MyService:
    def __init__(self):
        pass

    def process_data(self, data):
        return data * 2

def main():
    service = MyService()
    service.process_data(10)
        `;

        console.log("\nParsing code...");



        // ==========================================
        // [BEFORE] 手動解析と保存
        // ------------------------------------------
        // const result = await db.run(
        //     "?[] <- [['Hello', 'CozoDB (Success!)']]", 
        //     "{}" // ← これが必須！
        // );
        // ==========================================

        // ==========================================
        // [AFTER] メソッド呼び出し
        // ------------------------------------------
        // ファイルパスと中身を渡すだけで、解析→DB保存までやってくれます
        await graph.processFile(dummyFile, dummyCode);
        // ==========================================


        
        // console.log("\n🎉🎉🎉 MISSION COMPLETE! 🎉🎉🎉");
        // console.log("✅ CozoDB Query Result:", result);


        // ==========================================
        // [BEFORE] 直接実行
        //
        // [AFTER] ラッパー経由で実行
        // 欲しいカラム（file_path, name, kind...）を明示的に指定します
        const result = await graph.query("?[file_path, name, kind, start_line, end_line] := *symbols{file_path, name, kind, start_line, end_line}");
        // ==========================================

        console.log("Result:", JSON.stringify(result, null, 2));

        // 成功なら、MyService(class), process_data(function), main(function) 等が表示されます

    } catch (error) {
        console.error("❌ Error:", error);
        console.error("❌ Error:", error);
    }
}

test();