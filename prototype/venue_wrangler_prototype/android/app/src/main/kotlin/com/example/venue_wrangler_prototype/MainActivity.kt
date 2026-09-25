package com.example.venue_wrangler_prototype

import android.content.Intent
import android.content.Context
import android.content.RestrictionsManager
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

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "app.venuewranglerenterprise/managed_configuration")
            .setMethodCallHandler { call, result ->
                if (call.method != "readManagedConfiguration") {
                    result.notImplemented()
                    return@setMethodCallHandler
                }
                try {
                    val manager = getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager
                    val restrictions = manager.applicationRestrictions
                    val values = hashMapOf<String, Any>()
                    if (restrictions.containsKey("server_url")) values["server_url"] = restrictions.getString("server_url") ?: ""
                    if (restrictions.containsKey("organization_hint")) values["organization_hint"] = restrictions.getString("organization_hint") ?: ""
                    if (restrictions.containsKey("allow_camera_evidence")) values["allow_camera_evidence"] = restrictions.getBoolean("allow_camera_evidence")
                    if (restrictions.containsKey("allow_location_evidence")) values["allow_location_evidence"] = restrictions.getBoolean("allow_location_evidence")
                    if (restrictions.containsKey("offline_cache_max_hours")) values["offline_cache_max_hours"] = restrictions.getInt("offline_cache_max_hours")
                    result.success(values)
                } catch (error: Exception) {
                    result.error("managed_config_unavailable", "Could not read managed app configuration.", null)
                }
            }
    }
}
