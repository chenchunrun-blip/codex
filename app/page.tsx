import Link from "next/link"

export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-gray-50 to-slate-100">
      <div className="max-w-6xl mx-auto text-center px-4 py-16">
        {/* Logo */}
        <div className="mb-12 flex justify-center">
          <div className="w-40 h-40 bg-white rounded-2xl shadow-lg flex items-center justify-center p-6 border border-gray-200">
            <img
              src="/logo.jpg"
              alt="MarqDex Logo"
              className="w-full h-full object-contain"
            />
          </div>
        </div>

        {/* Title */}
        <h1 className="text-7xl font-bold text-slate-900 mb-6 tracking-tight">
          MarqDex
        </h1>
        <p className="text-2xl text-slate-600 mb-8 font-light tracking-wide">
          AI-Powered Collaborative Workspace
        </p>
        <p className="text-lg text-slate-500 mb-20 max-w-3xl mx-auto leading-relaxed">
          A modern platform for teams to collaborate on documents in real-time,
          enhanced by intelligent AI assistance and professional templates
        </p>

        {/* Feature Cards */}
        <div className="grid md:grid-cols-3 gap-8 mb-16">
          <div className="bg-white p-10 rounded-2xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow duration-300">
            <div className="w-14 h-14 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-6">
              <span className="text-3xl">📝</span>
            </div>
            <h3 className="text-xl font-semibold mb-3 text-slate-900">Smart Templates</h3>
            <p className="text-slate-600 leading-relaxed">
              Professional templates for problem definition, solution design,
              execution tracking, and project retrospectives
            </p>
          </div>

          <div className="bg-white p-10 rounded-2xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow duration-300">
            <div className="w-14 h-14 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-6">
              <span className="text-3xl">👥</span>
            </div>
            <h3 className="text-xl font-semibold mb-3 text-slate-900">Real-time Collaboration</h3>
            <p className="text-slate-600 leading-relaxed">
              Work together seamlessly with your team featuring live editing,
              presence indicators, and instant synchronization
            </p>
          </div>

          <div className="bg-white p-10 rounded-2xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow duration-300">
            <div className="w-14 h-14 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-6">
              <span className="text-3xl">🤖</span>
            </div>
            <h3 className="text-xl font-semibold mb-3 text-slate-900">AI Integration</h3>
            <p className="text-slate-600 leading-relaxed">
              Generate, optimize, and transform content with AI-powered tools
              compatible with OpenAI and other leading AI services
            </p>
          </div>
        </div>

        {/* Additional Features */}
        <div className="grid md:grid-cols-2 gap-8 mb-16">
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow duration-300">
            <div className="flex items-start gap-5">
              <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <span className="text-2xl">📁</span>
              </div>
              <div className="text-left">
                <h3 className="text-lg font-semibold text-slate-900 mb-2">File Import & Conversion</h3>
                <p className="text-slate-600 text-sm leading-relaxed">
                  Seamlessly import documents in multiple formats including Word and Markdown.
                  AI-enhanced conversion ensures perfect formatting every time.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow duration-300">
            <div className="flex items-start gap-5">
              <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <span className="text-2xl">📊</span>
              </div>
              <div className="text-left">
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Team & Project Management</h3>
                <p className="text-slate-600 text-sm leading-relaxed">
                  Organize work across multiple teams and projects with granular
                  access control and comprehensive collaboration features.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* CTA Buttons */}
        <div className="flex gap-4 justify-center">
          <Link
            href="/login"
            className="px-12 py-4 bg-slate-900 text-white rounded-xl font-semibold hover:bg-slate-800 transition-colors duration-200 shadow-sm"
          >
            Sign In
          </Link>
          <Link
            href="/register"
            className="px-12 py-4 bg-white text-slate-900 border border-slate-300 rounded-xl font-semibold hover:bg-slate-50 hover:border-slate-400 transition-all duration-200"
          >
            Create Account
          </Link>
        </div>

        {/* Footer */}
        <div className="mt-20 text-slate-400 text-sm">
          <p>Designed for Modern Teams • Powered by AI</p>
        </div>
      </div>
    </div>
  )
}
