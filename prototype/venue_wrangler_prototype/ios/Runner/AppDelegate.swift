import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    let managedConfigurationChannel = FlutterMethodChannel(
      name: "app.venuewranglerenterprise/managed_configuration",
      binaryMessenger: engineBridge.applicationRegistrar.messenger()
    )
    managedConfigurationChannel.setMethodCallHandler { call, result in
      guard call.method == "readManagedConfiguration" else {
        result(FlutterMethodNotImplemented)
        return
      }
      let values = UserDefaults.standard.dictionary(forKey: "com.apple.configuration.managed") ?? [:]
      result(values)
    }

    let channel = FlutterMethodChannel(
      name: "app.venuewranglerenterprise/external_url",
      binaryMessenger: engineBridge.applicationRegistrar.messenger()
    )
    channel.setMethodCallHandler { call, result in
      guard call.method == "openUrl" else {
        result(FlutterMethodNotImplemented)
        return
      }
      guard
        let rawUrl = call.arguments as? String,
        let url = URL(string: rawUrl),
        url.scheme == "https",
        url.host != nil
      else {
        result(FlutterError(code: "invalid_url", message: "Only HTTPS evidence links can be opened.", details: nil))
        return
      }
      UIApplication.shared.open(url, options: [:]) { opened in
        if opened {
          result(nil)
        } else {
          result(FlutterError(code: "open_failed", message: "Could not open the evidence link.", details: nil))
        }
      }
    }
  }
}
