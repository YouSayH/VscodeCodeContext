import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';

// レイアウト拡張を登録
cytoscape.use(fcose);

interface GraphCanvasProps {
    elements: {
        nodes: any[];
        edges: any[];
    };
}

export const GraphCanvas = ({ elements }: GraphCanvasProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const cyRef = useRef<cytoscape.Core | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        // 1. Cytoscapeの初期化
        cyRef.current = cytoscape({
            container: containerRef.current,
            elements: [], // 初期データは空で開始（下のuseEffectでロード）
            
            // 基本スタイル定義
            style: [
                {
                    selector: 'node',
                    style: {
                        'background-color': '#666',
                        'label': 'data(label)',
                        'color': '#fff',
                        'text-valign': 'center',
                        'text-halign': 'center',
                        'text-outline-width': 2,
                        'text-outline-color': '#333',
                        'font-size': '12px',
                        'z-index': 10
                    }
                },
                {
                    selector: 'node[kind="file"]',
                    style: {
                        'shape': 'round-rectangle',
                        'background-color': '#0d47a1', // 青
                        'text-outline-color': '#0d47a1',
                        'width': 'label',
                        'padding': '12px'
                    }
                },
                {
                    selector: 'node[kind="class"]',
                    style: {
                        'shape': 'diamond',
                        'background-color': '#00695c', // 緑
                        'text-outline-color': '#00695c',
                        'width': 40,
                        'height': 40
                    }
                },
                {
                    selector: 'node[kind="function"]',
                    style: {
                        'shape': 'ellipse',
                        'background-color': '#ef6c00', // オレンジ
                        'text-outline-color': '#ef6c00',
                        'width': 30,
                        'height': 30
                    }
                },
                // --- エッジ（関係線）のスタイル改善 ---
                {
                    selector: 'edge',
                    style: {
                        'width': 2,
                        'line-color': '#a0a0a0',
                        'target-arrow-color': '#a0a0a0',
                        'target-arrow-shape': 'triangle',
                        'curve-style': 'bezier',
                        'arrow-scale': 1.2,
                        // ラベル表示設定
                        'label': 'data(type)', 
                        'font-size': '10px',
                        'color': '#eeeeee',
                        'text-rotation': 'autorotate', // 線に沿って回転
                        'text-background-color': '#1e1e1e', // 背景色で文字を見やすく
                        'text-background-opacity': 1,
                        'text-background-padding': '3px',
                        'text-background-shape': 'roundrectangle'
                    }
                },
                {
                    selector: 'edge[type="import"]',
                    style: {
                        'line-style': 'dashed',
                        'line-color': '#5c6bc0',
                        'target-arrow-color': '#5c6bc0',
                        'color': '#9fa8da'
                    }
                },
                {
                    selector: 'edge[type="call"]',
                    style: {
                        'line-color': '#ffca28',
                        'target-arrow-color': '#ffca28',
                        'color': '#ffecb3'
                    }
                },
                {
                    selector: 'edge[type="contains"]',
                    style: {
                        'width': 1,
                        'line-color': '#424242',
                        'target-arrow-color': '#424242',
                        'color': '#757575'
                    }
                }
            ],
            wheelSensitivity: 0.2,
        });

        // クリーンアップ
        return () => {
            if (cyRef.current) cyRef.current.destroy();
        };
    }, []);

    // データ更新時の再描画とレイアウト適用
    useEffect(() => {
        if (!cyRef.current) return;

        const cy = cyRef.current;

        // データ入れ替え
        cy.elements().remove();
        cy.add(elements);
        
        // --- レイアウト設定 (重なり防止チューニング) ---
        cy.layout({ 
            name: 'fcose', 
            // アニメーション設定
            animate: true,
            animationDuration: 800,
            
            // ★重要: 初期配置をランダムにすることで「初期の重なり」を防ぐ
            randomize: true, 
            
            // クオリティ設定
            quality: 'default',
            
            // ノード間の反発力（大きくすると広がる）
            nodeRepulsion: 6500, 
            
            // エッジの理想的な長さ（長くすると広がる）
            idealEdgeLength: 150,
            
            // ノードのサイズを考慮して重ならないようにする
            nodeDimensionsIncludeLabels: true,
            
            // 異なるコンポーネント（繋がっていないグループ）をどう配置するか
            packComponents: true,
            
            // 終了後に全体を画面に収める
            fit: true,
            padding: 30
        } as any).run();

    }, [elements]);

    return (
        <div 
            ref={containerRef} 
            style={{ width: '100%', height: '100%', backgroundColor: '#1e1e1e' }} 
        />
    );
};