import { useEffect, useState } from 'react';
import './App.css';
import { vscode } from './utilities/vscode';
import { GraphCanvas } from './components/GraphCanvas';

interface GraphData {
    nodes: any[];
    edges: any[];
}

function App() {
    const [graphData, setGraphData] = useState<GraphData | null>(null);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'UPDATE_GRAPH':
                    console.log('📡 Received Graph Data:', message.data);
                    setGraphData(message.data);
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        vscode.postMessage({ command: 'REQUEST_INIT' });

        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // ノードダブルクリック時のハンドラー
    const handleNodeDoubleClick = (nodeData: any) => {
        // ノードデータにファイルパスなどが含まれている前提
        if (nodeData.path) {
            vscode.postMessage({ 
                command: 'JUMP_TO_CODE', 
                path: nodeData.path,
                line: nodeData.line || 1 // 行番号がない場合は1行目へ
            });
        }
    };
return (
        <div className="app-container">
            {graphData ? (
                // データがある場合はグラフを描画
                <div className="graph-wrapper" style={{ width: '100vw', height: '100vh' }}>
                     {/* ハンドラーを渡す */}
                     <GraphCanvas 
                        elements={graphData} 
                        onNodeDoubleClick={handleNodeDoubleClick}
                     />
                     <div className="status-overlay">
                        Loaded: {graphData.nodes.length} nodes
                     </div>
                </div>
            ) : (
                <div className="loading">
                    <p>Waiting for code analysis...</p>
                </div>
            )}
        </div>
    );
}

export default App;