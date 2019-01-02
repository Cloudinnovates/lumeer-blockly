/*
 * Lumeer: Modern Data Definition and Processing Platform
 *
 * Copyright (C) since 2017 Answer Institute, s.r.o. and/or its affiliates.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import {Component, OnInit, ElementRef, ViewChild, Input, OnDestroy} from '@angular/core';
import * as toolbox from './blockly.toolbox';
import {Collection, LinkType, Variable} from '../../model/model';

declare var Blockly: any;

@Component({
  selector: 'blockly',
  templateUrl: './blockly.component.html',
  styleUrls: ['./blockly.component.scss']
})
export class BlocklyComponent implements OnInit, OnDestroy {

  @Input('collections')
  public collections: Collection[];

  @Input('linkTypes')
  public linkTypes: LinkType[];

  @Input('variables')
  public variables: Variable[];

  @ViewChild('blockly')
  private blocklyElement: ElementRef;

  private workspace: any;

  public static THESE = new Map();

  private static readonly DOCUMENT_TYPE_SUFFIX = '_document';
  private static readonly DOCUMENT_ARRAY_TYPE_SUFFIX = '_document_array';
  private static readonly LINK_TYPE_SUFFIX = '_link';
  private static readonly ARRAY_TYPE_SUFFIX = '_array';
  private static readonly FOREACH_DOCUMENT_ARRAY = 'foreach_document_array';
  private static readonly GET_ATTRIBUTE = 'get_attribute';
  private static readonly VARIABLES_GET_PREFIX = 'variables_get_';

  constructor() {}

  public ngOnInit() {
    Blockly.HSV_VALUE = 0.85;

    this.workspace = Blockly.inject('blockly', {toolbox: toolbox.BLOCKLY_TOOLBOX});

    Blockly.Blocks[BlocklyComponent.FOREACH_DOCUMENT_ARRAY] = {
      init: function() {
        this.jsonInit({
          type: BlocklyComponent.FOREACH_DOCUMENT_ARRAY,
          message0: 'for each document %1 in %2',
          args0: [
            {
              type: 'field_variable',
              name: 'VAR',
              variable: null
            },
            {
              type: 'input_value',
              name: 'LIST',
              check: null
            }
          ],
          message1: 'do this %1',
          args1: [{
            type: 'input_statement',
            name: 'DO'
          }],
          previousStatement: null,
          nextStatement: null,
          colour: '#e74c3c',
        });
      }
    };

    Blockly.Blocks[BlocklyComponent.GET_ATTRIBUTE] = {
      init: function() {
        this.jsonInit({
          type: BlocklyComponent.GET_ATTRIBUTE,
          message0: 'get %1 of %2',
          args0: [
            {
              type: 'field_dropdown',
              name: 'ATTR',
              options: [
                [
                  '?',
                  '?'
                ]
              ]
            },
            {
              type: 'input_value',
              name: 'DOCUMENT'
            }
          ],
          output: null,
          colour: '#18bc9c',
          tooltip: '',
          helpUrl: ''
        });
      }
    };

    BlocklyComponent.THESE.set(this.workspace.id, this); // TODO: is there a better way?

    this.workspace.addChangeListener(changeEvent => this.onWorkspaceChange(changeEvent));

    this.workspace.registerToolboxCategoryCallback(
      'DOCUMENT_VARIABLES', this.registerDocumentVariables);
    this.workspace.registerToolboxCategoryCallback(
      'LINKS', this.registerLinks);

    this.variables.forEach(variable =>
      this.workspace.createVariable(variable.name, variable.collectionId + BlocklyComponent.DOCUMENT_TYPE_SUFFIX, null));
  }

  public ngOnDestroy(): void {
    BlocklyComponent.THESE.delete(this.workspace.id);
  }

  private onWorkspaceChange(changeEvent): void {
    if (changeEvent.newParentId) { // is there a new connection made?
      const block = this.workspace.getBlockById(changeEvent.blockId);
      const blockOutputType = (block.outputConnection && block.outputConnection.check_ && block.outputConnection.check_[0]) ? block.outputConnection.check_[0] : '';
      const parentBlock = this.workspace.getBlockById(changeEvent.newParentId);

      // is it a document being connected to ...
      if (blockOutputType.endsWith(BlocklyComponent.DOCUMENT_TYPE_SUFFIX)) {
        // ...a link?
        if (parentBlock.type.endsWith(BlocklyComponent.LINK_TYPE_SUFFIX)) {
          // set the output type to the opposite of what is connected on the input (links are symmetric)
          const linkParts = parentBlock.type.split('_');
          const counterpart = linkParts[0] === blockOutputType.replace(BlocklyComponent.DOCUMENT_TYPE_SUFFIX, '') ? linkParts[1] : linkParts[0];
          parentBlock.setOutput(true, counterpart + BlocklyComponent.DOCUMENT_ARRAY_TYPE_SUFFIX);
        }
      } else { // disconnect invalid foreach input
        if (parentBlock.type === BlocklyComponent.FOREACH_DOCUMENT_ARRAY) {
          if (parentBlock.getInput('LIST').connection.db_[0].sourceBlock_.id === block.id) {
            if (!blockOutputType.endsWith(BlocklyComponent.DOCUMENT_ARRAY_TYPE_SUFFIX)) {
              parentBlock.getInput('LIST').connection.disconnect();
            } else {
              parentBlock.getField('VAR').getVariable().type = blockOutputType.replace(BlocklyComponent.ARRAY_TYPE_SUFFIX, '');
            }
          }
        }
      }

      if ((blockOutputType.endsWith(BlocklyComponent.DOCUMENT_TYPE_SUFFIX) || blockOutputType.endsWith(BlocklyComponent.DOCUMENT_ARRAY_TYPE_SUFFIX)) && parentBlock.type === BlocklyComponent.GET_ATTRIBUTE) {
        const options = parentBlock.getField('ATTR').getOptions();
        const originalLength = options.length;
        const this_ = BlocklyComponent.THESE.get(changeEvent.workspaceId);
        const collection = this_.getCollection(blockOutputType.split('_')[0]);

        let defaultValue = '';
        collection.attributes.forEach(attribute => {
          options.push([attribute.name, attribute.id]);

          if (attribute.id === collection.defaultAttributeId) {
            defaultValue = attribute.name;
          }
        });

        if (!defaultValue) {
          defaultValue = collection.attributes[0].name;
        }

        parentBlock.getField('ATTR').setValue(defaultValue);
        options.splice(0, originalLength);
      }
    } else if (changeEvent.oldParentId) { // reset output type and disconnect when linked document is removed
      const block = this.workspace.getBlockById(changeEvent.blockId);
      const blockOutputType = block.outputConnection.check_[0] || '';
      const parentBlock = this.workspace.getBlockById(changeEvent.oldParentId);

      if (blockOutputType.endsWith(BlocklyComponent.DOCUMENT_TYPE_SUFFIX)) {
        if (parentBlock.type.endsWith(BlocklyComponent.LINK_TYPE_SUFFIX) && parentBlock.outputConnection) {
          parentBlock.setOutput(true, 'unknown');
          console.log('setting parent output unknown');
          if (parentBlock.outputConnection) {
            try {
              parentBlock.outputConnection.disconnect();
              parentBlock.moveBy(Blockly.SNAP_RADIUS, Blockly.SNAP_RADIUS);
            } catch (e) {
              // nps, already disconnected
            }
          }
        }
      }

      // reset list of attributes upon disconnection
      if (parentBlock.type === BlocklyComponent.GET_ATTRIBUTE) {
        const options = parentBlock.getField('ATTR').getOptions();
        const originalLength = options.length;
        parentBlock.getField('ATTR').setValue('N/A');
        options.push(['?', '?']);
        options.splice(0, originalLength);
      }
    }
    console.log(changeEvent);
  }

  private registerDocumentVariables(workspace): any[] {
    const xmlList = [];
    const this_ = BlocklyComponent.THESE.get(workspace.id);

    workspace.getAllVariables().forEach(variable => {
      if (variable.type.endsWith(BlocklyComponent.DOCUMENT_TYPE_SUFFIX)) {
        this_.ensureVariableTypeBlock(this_, variable.type);
        const blockText = '<xml>' +
          '<block type="' + BlocklyComponent.VARIABLES_GET_PREFIX + variable.type + '">' +
          '<field name="VAR" id="' + variable.getId() + '" variabletype="' + variable.type + '">' + variable.name + '</field>' +
          '</block>' +
          '</xml>';
        const block = Blockly.Xml.textToDom(blockText).firstChild;
        xmlList.push(block);
      }
    });

    xmlList.push(Blockly.Xml.textToDom('<xml><sep gap="48"></sep></xml>').firstChild);
    xmlList.push(Blockly.Xml.textToDom('<xml><block type="' + BlocklyComponent.GET_ATTRIBUTE + '"></block></xml>').firstChild);

    return xmlList;
  }

  private getCollection(id: string): Collection {
    return this.collections.find(collection => collection.id === id);
  }

  private ensureVariableTypeBlock(this_: BlocklyComponent, type: string): void {
    if (!Blockly.Blocks[type]) {
      const collection = this_.getCollection(type.replace(BlocklyComponent.DOCUMENT_TYPE_SUFFIX, ''));

      Blockly.Blocks[BlocklyComponent.VARIABLES_GET_PREFIX + type] = {
        init: function() {
          this.jsonInit({
            type: BlocklyComponent.VARIABLES_GET_PREFIX + type,
            message0: '%1 %2 %3',
            args0: [
              {
                type: 'field_fa',
                icon: collection.icon,
                iconColor: collection.color
              },
              {
                type: 'field_label',
                text: collection.name
              },
              {
                type: 'field_variable',
                name: 'VAR',
                variable: '%{BKY_VARIABLES_DEFAULT_NAME}',
                variableTypes: [type],
                defaultType: type
              }
            ],
            colour: this_.shadeColor(collection.color, 0.5), // TODO: how many percent should go here?
            output: type,
          });
        }
      };
    }
  }

  private getBlocklyLinkType(linkType: LinkType): string {
    return linkType.collectionIds[0] + '_' + linkType.collectionIds[1] + BlocklyComponent.LINK_TYPE_SUFFIX;
  }

  private registerLinks(workspace): any[] {
    const xmlList = [];
    const this_: BlocklyComponent = BlocklyComponent.THESE.get(workspace.id);

    this_.linkTypes.forEach(linkType => {
      this_.ensureLinkTypeBlock(this_, linkType);

      const blockText = '<xml>' +
        '<block type="' + this_.getBlocklyLinkType(linkType) + '">' +
        '</block>' +
        '</xml>';
      const block = Blockly.Xml.textToDom(blockText).firstChild;
      xmlList.push(block);
    });

    return xmlList;
  }

  private ensureLinkTypeBlock(this_: BlocklyComponent, linkType: LinkType) {
    const type = this_.getBlocklyLinkType(linkType);

    if (!Blockly.Blocks[type]) {
      const c1 = this_.getCollection(linkType.collectionIds[0]);
      const c2 = this_.getCollection(linkType.collectionIds[1]);

      Blockly.Blocks[type] = {
        init: function() {
          this.jsonInit({
            type: type,
            message0: '%1%2 %3 %4',
            args0: [
              {
                type: 'field_fa',
                icon: c1.icon,
                iconColor: c1.color
              },
              {
                type: 'field_fa',
                icon: c2.icon,
                iconColor: c2.color
              },
              {
                type: 'field_label',
                text: linkType.name,
                'class': 'text-primary'
              },
              {
                type: 'input_value',
                name: 'NAME',
                check: [
                  linkType.collectionIds[0] + BlocklyComponent.DOCUMENT_TYPE_SUFFIX,
                  linkType.collectionIds[1] + BlocklyComponent.DOCUMENT_TYPE_SUFFIX
                ]
              }
            ],
            output: 'unknown',
            colour: '#F7F7F7',
            tooltip: '',
            helpUrl: '',
          });
        }
      };
    }
  }

  private shadeColor(color: string, percent: number): string {
    const f = parseInt(color.slice(1), 16),
      t = percent < 0 ? 0 : 255,
      p = percent < 0 ? percent * -1 : percent,
      R = f >> 16,
      G = (f >> 8) & 0x00ff,
      B = f & 0x0000ff;
    return (
      '#' +
      (
        0x1000000 +
        (Math.round((t - R) * p) + R) * 0x10000 +
        (Math.round((t - G) * p) + G) * 0x100 +
        (Math.round((t - B) * p) + B)
      )
        .toString(16)
        .slice(1)
    );
  }

  public generateXml(): void {
    const xml = Blockly.Xml.workspaceToDom(this.workspace);
    const xml_text = Blockly.Xml.domToPrettyText(xml);

    console.log(xml_text);
  }
}
