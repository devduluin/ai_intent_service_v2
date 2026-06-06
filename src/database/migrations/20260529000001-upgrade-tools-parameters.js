'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // =========================
    // Ubah ENUM -> STRING
    // =========================

    // Tambah kolom baru sementara
    await queryInterface.addColumn('tools_parameters', 'type_temp', {
      type: Sequelize.STRING(50),
      allowNull: false,
      defaultValue: 'string',
    })

    // Copy data lama
    await queryInterface.sequelize.query(`
      UPDATE tools_parameters
      SET "type_temp" = "type"::text
    `)

    // Hapus kolom lama
    await queryInterface.removeColumn('tools_parameters', 'type')

    // Rename kolom baru
    await queryInterface.renameColumn(
      'tools_parameters',
      'type_temp',
      'type'
    )

    // Drop enum PostgreSQL lama
    await queryInterface.sequelize.query(`
      DROP TYPE IF EXISTS "enum_tools_parameters_type"
    `)

    // =========================
    // Tambahan kolom baru
    // =========================

    await queryInterface.addColumn('tools_parameters', 'label', {
      type: Sequelize.STRING(150),
      allowNull: true,
    })

    await queryInterface.addColumn('tools_parameters', 'config', {
      type: Sequelize.JSONB,
      allowNull: true,
    })

    await queryInterface.addColumn('tools_parameters', 'order', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    })

    await queryInterface.addColumn('tools_parameters', 'isHidden', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    })

    // Optional:
    // Ubah defaultValue jadi TEXT agar lebih fleksibel
    await queryInterface.changeColumn('tools_parameters', 'defaultValue', {
      type: Sequelize.TEXT,
      allowNull: true,
    })
  },

  async down(queryInterface, Sequelize) {
    // =========================
    // Rollback kolom tambahan
    // =========================

    await queryInterface.removeColumn('tools_parameters', 'label')
    await queryInterface.removeColumn('tools_parameters', 'config')
    await queryInterface.removeColumn('tools_parameters', 'order')
    await queryInterface.removeColumn('tools_parameters', 'isHidden')

    // Kembalikan defaultValue
    await queryInterface.changeColumn('tools_parameters', 'defaultValue', {
      type: Sequelize.STRING(255),
      allowNull: true,
    })

    // =========================
    // Kembalikan ENUM lama
    // =========================

    // Buat enum type kembali
    await queryInterface.sequelize.query(`
      CREATE TYPE "enum_tools_parameters_type"
      AS ENUM ('string', 'number', 'boolean')
    `)

    // Tambah kolom enum sementara
    await queryInterface.addColumn('tools_parameters', 'type_temp', {
      type: Sequelize.ENUM('string', 'number', 'boolean'),
      allowNull: false,
      defaultValue: 'string',
    })

    // Copy hanya type yang valid (validasi data)
    await queryInterface.sequelize.query(`
      UPDATE tools_parameters
      SET "type_temp" =
        CASE
          WHEN "type" IN ('string', 'number', 'boolean')
            THEN "type"::enum_tools_parameters_type
          ELSE 'string'
        END
    `)

    // Hapus type string
    await queryInterface.removeColumn('tools_parameters', 'type')

    // Rename kembali
    await queryInterface.renameColumn(
      'tools_parameters',
      'type_temp',
      'type'
    )
  },
}
