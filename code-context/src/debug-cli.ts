import * as path from 'path';
import { CodeGraph } from './code-graph';

async function main() {
    // Wasmフォルダのパス設定 (実行場所に合わせて調整)
    const wasmDir = path.join(__dirname, '../wasm');
    
    console.log(`📂 Wasm Dir: ${wasmDir}`);
    const graph = new CodeGraph(wasmDir);
    
    // 1. 初期化
    await graph.init();

    // 2. テスト用Pythonコード
    // (Import, Class, Method, Callが含まれるコード)
    const testFile = 'src/test_sample.py';
    const content = `
import os
import sys

class User:
    def __init__(self, name):
        self.name = name

    def greet(self):
        print("Hello " + self.name)

def main():
    u = User("CodeContext")
    u.greet()
    os.getcwd()
`;

    console.log("--- 🔄 Processing Start ---");
    await graph.processFile(testFile, content);

    // 3. 結果確認 (Relationsテーブルの中身を表示)
    console.log("\n--- 🕸️  Relations (Edges) ---");
    // CozoDBクエリ: relationsテーブルの全データを取得
    const result = await graph.query("?[from_id, to_id, type] := *relations[from_id, to_id, type, count]");
    
    if (result && result.rows) {
        // テーブル形式で表示 (from -> to [type])
        console.table(result.rows);
        
        console.log(`\n✅ 検証成功: ${result.rows.length} 本のエッジが見つかりました。`);
        console.log("期待されるエッジ:");
        console.log(" - import: os, sys");
        console.log(" - contains: User->__init__, User->greet");
        console.log(" - call: User(init), u.greet, os.getcwd");
    } else {
        console.error("❌ エッジが見つかりませんでした。", result);
    }
}

main().catch(err => console.error(err));