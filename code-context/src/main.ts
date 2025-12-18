#!/usr/bin/env node
import { Command } from 'commander';
import * as glob from 'glob';
import * as path from 'path';
import * as fs from 'fs';
import { CodeGraph } from './code-graph';

const program = new Command();

program
    .name('code-context')
    .description('Analyze code and generate context for LLMs')
    .version('0.1.0');

program
    .command('index <dir>')
    .description('Index a directory and show code structure')
    .action(async (dir) => {
        const absolutePath = path.resolve(dir);
        console.log(`🔍 Indexing directory: ${absolutePath}`);

        const wasmDir = path.join(__dirname, '../wasm');
        const graph = new CodeGraph(wasmDir);
        
        try {
            await graph.init();

            /**
             * ======================================================================================
             * [TROUBLESHOOTING LOG 3: Windows Path Issue]
             * ======================================================================================
             * ■ エラー内容: 
             * Windows環境で実行すると "Found 0 Python files" になり、ファイルが見つからない。
             * * ■ 原因:
             * `path.join` はWindowsではバックスラッシュ `\` を使うが、
             * `glob` ライブラリはパス区切りにスラッシュ `/` しか受け付けない仕様のため。
             * * ■ 解法:
             * `.replace(/\\/g, '/')` で強制的にバックスラッシュをスラッシュに置換する。
             * ======================================================================================
             */
            const pattern = path.join(absolutePath, '**/*.{py,ts}').replace(/\\/g, '/');
            
            const files = glob.sync(pattern, {
                ignore: ['**/node_modules/**', '**/.git/**', '**/venv/**']
            });

            console.log(`📄 Found ${files.length} Python files. Parsing...`);

            for (const file of files) {
                const relativePath = path.relative(process.cwd(), file);
                const content = fs.readFileSync(file, 'utf-8');
                try {
                    await graph.processFile(relativePath, content);
                    process.stdout.write('.');
                } catch (e) {
                    console.error(`\n⚠️  Failed: ${relativePath}`);
                }
            }
            console.log("\n");

            // 集計クエリの実行
            // (code-graph.ts側で JSON.parse しているので、ここではオブジェクトとして扱える)
            console.log("📊 Project Statistics:");
            const stats = await graph.query(`
                ?[k, c] := *symbols{kind: k}, c = count(k)
            `);
            
            if (stats.ok && stats.rows.length > 0) {
                console.table(stats.rows.map((row: any) => ({ Type: row[0], Count: row[1] })));
            }

            // Tree View の表示
            console.log("\n🌳 Code Structure Map (For LLM Context):");
            console.log("==========================================");

            const allSymbols = await graph.query(`
                ?[file, name, kind, line] := *symbols{file_path: file, name, kind, start_line: line}
                :order file, line
            `);

            if (allSymbols.ok) {
                let currentFile = "";
                allSymbols.rows.forEach((row: any) => {
                    const [file, name, kind, line] = row;
                    
                    if (file !== currentFile) {
                        console.log(`\n📄 ${file}`);
                        currentFile = file;
                    }

                    const icon = kind === 'class' ? '🔷' : 'ƒ ';
                    console.log(`  L ${line.toString().padEnd(3)} ${icon} ${name}`);
                });
            }
            console.log("\n==========================================");

        } catch (error) {
            console.error("❌ Fatal Error:", error);
        }
    });

program.parse(process.argv);