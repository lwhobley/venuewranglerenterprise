package com.example.venue_wrangler_prototype

import android.content.Intent
import android.net.Uri
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "app.venuewranglerenterprise/external_url")
            .setMethodCallHandler { call, result ->
                if (call.method != "openUrl") {
                    result.notImplemented()
                    return@setMethodCallHandler
                }
                val rawUrl = call.arguments as? String
                val uri = rawUrl?.let(Uri::parse)
                if (uri == null || uri.scheme != "https" || uri.host.isNullOrBlank()) {
                    result.error("invalid_url", "Only HTTPS evidence links can be opened.", null)
                    return@setMethodCallHandler
                }
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                    result.success(null)
                } catch (error: Exception) {
                    result.error("open_failed", "No application could open the evidence link.", null)
                }
            }
    }
}
