import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';

/**
 * ======================================================================================
 * [TROUBLESHOOTING LOG / 開発ログ]
 * ======================================================================================
 * * 1. Cytoscapeイベントハンドリング (Event Listener)
 * - 現象: ダブルクリックしても何も反応しない（エラーも出ない）。
 * - 原因: Propsとして `onNodeDoubleClick` を受け取っていたが、Cytoscapeインスタンスへのイベント登録 (`cy.on('dblclick', ...)`) を実装し忘れていた。
 * - 検知: console.logをハンドラ内に仕込んだが発火せず、リスナー登録自体が疑われた。
 * - 解決策: useEffect内で `cy.on('dblclick', 'node', ...)` を明示的に記述。
 * * 2. グラフ位置の維持 (Layout Stability)
 * - 現象: コードを編集して保存するたびに、グラフがランダムに再配置され、見失ってしまう。
 * - 原因: データ更新時に毎回 `cy.layout({ randomize: true })` が実行されていたため。
 * - 解決策: 
 * a) 再描画前に `node.position()` で全ノードの座標を一時保存し、描画後に復元するロジックを追加。
 * b) 初回以外の描画では `randomize: false` `fit: false` に設定し、ユーザーの視点を維持するように変更。
 * ======================================================================================
 */

// レイアウト拡張を登録
cytoscape.use(fcose);

interface GraphCanvasProps {
    elements: {
        nodes: any[];
        edges: any[];
    };
    onNodeDoubleClick?: (data: any) => void;
}

export const GraphCanvas = ({ elements, onNodeDoubleClick }: GraphCanvasProps) => {
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
                        /**
                         * [トラブルシューティング・ログ: スタイルの型]
                         * - エラー: "Type 'number' is not assignable to type 'string'".
                         * - 解決策: Cytoscapeのスタイル値は生の数値ではなく、単位付きの文字列（例: '10px'）である必要がある。
                         */
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
                // エッジ（関係線）のスタイル改善
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
                        /**
                         * [トラブルシューティング・ログ: 形状の構文]
                         * - 警告: "round-rectangle" (ハイフンあり) は無効な値。
                         * - 解決策: 正しい描画のためには "roundrectangle" (ハイフンなし) を使用する。
                         */
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

        const cy = cyRef.current;
        // ノードのダブルクリックイベント
        cy.on('dblclick', 'node', (evt) => {
            const node = evt.target;
            const data = node.data();
            // 親から渡された関数が存在すれば実行し、ノードのデータを渡す
            if (onNodeDoubleClick) {
                onNodeDoubleClick(data);
            }
        });

        // UX向上: ホバー時にカーソルをポインターにする
        cy.on('mouseover', 'node', () => {
            if (containerRef.current) containerRef.current.style.cursor = 'pointer';
        });
        cy.on('mouseout', 'node', () => {
            if (containerRef.current) containerRef.current.style.cursor = 'default';
        });


        // クリーンアップ
        return () => {
            if (cyRef.current) cyRef.current.destroy();
        };
    }, []);// 依存配列は空のままでOK（onNodeDoubleClickはRefやイベント内で参照されるため）

    // データ更新時の再描画とレイアウト適用
useEffect(() => {
        if (!cyRef.current) return;

        const cy = cyRef.current;

        // 1. 現在のノード位置を保存 (IDをキーにする)
        const positions: Record<string, cytoscape.Position> = {};
        cy.nodes().forEach(node => {
            positions[node.id()] = { ...node.position() };
        });

        // 保存された位置があるかチェック（初回描画かどうかの判定に使用）
        const hasPositions = Object.keys(positions).length > 0;

        // 2. データ入れ替え
        cy.elements().remove();
        cy.add(elements);
        
        // 3. 位置の復元
        if (hasPositions) {
            cy.nodes().forEach(node => {
                const prevPos = positions[node.id()];
                if (prevPos) {
                    node.position(prevPos);
                }
            });
        }
        
        // 4. レイアウト実行
        cy.layout({ 
            name: 'fcose', 
            // アニメーション設定
            animate: true,
            animationDuration: 800,
            // 初期配置をランダムにすることで「初期の重なり」を防ぐ
            
            randomize: !hasPositions, 
            
            fit: !hasPositions,
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