import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen bg-[#0a0a0a] flex items-center justify-center text-white font-mono">
          <div className="text-center space-y-4 px-8 max-w-md">
            <div className="text-4xl">&#9888;</div>
            <h1 className="text-xl font-bold">Something went wrong</h1>
            <p className="text-sm text-gray-400">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold transition-colors"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
