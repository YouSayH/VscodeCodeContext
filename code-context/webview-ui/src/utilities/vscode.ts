// 1. 型定義を自前で行う（外部ライブラリ依存を削除）
interface WebviewApi<State> {
  postMessage(message: unknown): void;
  getState(): State | undefined;
  setState(newState: State): void;
}

declare function acquireVsCodeApi(): WebviewApi<unknown>;

class VSCodeAPIWrapper {
  private readonly vsCodeApi: WebviewApi<unknown> | undefined;

  constructor() {
    // Check if the acquireVsCodeApi function exists in the current environment
    if (typeof acquireVsCodeApi === "function") {
      this.vsCodeApi = acquireVsCodeApi();
    }
  }

  /**
   * Post a message to the extension host
   */
  public postMessage(message: unknown) {
    if (this.vsCodeApi) {
      this.vsCodeApi.postMessage(message);
    } else {
      console.log("VS Code API not available (Running in browser?)", message);
    }
  }
}

// Singleton instance
export const vscode = new VSCodeAPIWrapper();