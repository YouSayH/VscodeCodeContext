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

    return (
        <div className="app-container">
            {graphData ? (
                // データがある場合はグラフを描画
                <div className="graph-wrapper" style={{ width: '100vw', height: '100vh' }}>
                     <GraphCanvas elements={graphData} />
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