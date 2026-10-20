application { mainClass.set("io.cmpose.backendtemplate.MainKt") }
tasks.register<JavaExec>("runLocal") { mainClass.set("io.cmpose.backendtemplate.local.LocalMainKt") }
